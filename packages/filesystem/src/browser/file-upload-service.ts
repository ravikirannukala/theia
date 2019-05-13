/********************************************************************************
 * Copyright (C) 2019 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

// tslint:disable:no-any

import * as base64 from 'base64-js';
import { injectable, inject, postConstruct } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { CancellationTokenSource, CancellationToken, checkCancelled } from '@theia/core/lib/common/cancellation';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { MessageService } from '@theia/core/lib/common/message-service';
import { Progress } from '@theia/core/src/common/message-service-protocol';
import { FileUploadServer } from '../common/file-upload-server';

const maxChunkSize = 64 * 1024;

export interface FileUploadParams {
    source?: DataTransfer
    progress?: FileUploadProgressParams
}
export interface FileUploadProgressParams {
    text: string
}

export interface FileUploadResult {
    uploaded: URI[]
}

@injectable()
export class FileUploadService {

    static TARGET = 'target';
    static UPLOAD = 'upload';

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(FileUploadServer)
    protected readonly uploadServer: FileUploadServer;

    protected uploadForm: FileUploadService.Form;

    @postConstruct()
    protected init(): void {
        this.uploadForm = this.createUploadForm();
    }

    protected createUploadForm(): FileUploadService.Form {
        const targetInput = document.createElement('input');
        targetInput.type = 'text';
        targetInput.name = FileUploadService.TARGET;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = FileUploadService.UPLOAD;
        fileInput.multiple = true;

        const form = document.createElement('form');
        form.style.display = 'none';
        form.enctype = 'multipart/form-data';
        form.append(targetInput);
        form.append(fileInput);

        document.body.appendChild(form);

        fileInput.addEventListener('change', () => {
            if (this.deferredUpload && fileInput.value) {
                const body = new FormData(form);
                // clean up to allow upload to the same folder twice
                fileInput.value = '';
                const targetUri = new URI(<string>body.get(FileUploadService.TARGET));
                const { resolve, reject } = this.deferredUpload;
                this.deferredUpload = undefined;
                this.withProgress((progress, token) => {
                    const context: FileUploadService.Context = { totalSize: 0, entries: [], progress, token };
                    body.getAll(FileUploadService.UPLOAD).forEach((file: File) => this.indexFile(targetUri, file, context));
                    return this.doUpload(context);
                }, this.uploadForm.progress).then(resolve, reject);
            }
        });
        return { targetInput, fileInput };
    }

    protected deferredUpload: Deferred<FileUploadResult> | undefined;
    async upload(targetUri: string | URI, params: FileUploadParams = {}): Promise<FileUploadResult> {
        const { source } = params;
        if (source) {
            return this.withProgress(async (progress, token) => {
                const context: FileUploadService.Context = { totalSize: 0, entries: [], progress, token };
                await this.indexDataTransfer(new URI(String(targetUri)), source, context);
                return this.doUpload(context);
            }, params.progress);
        }
        this.deferredUpload = new Deferred<FileUploadResult>();
        this.uploadForm.targetInput.value = String(targetUri);
        this.uploadForm.fileInput.click();
        this.uploadForm.progress = params.progress;
        return this.deferredUpload.promise;
    }

    protected async doUpload({ entries, progress, token, totalSize }: FileUploadService.Context): Promise<FileUploadResult> {
        const result: FileUploadResult = { uploaded: [] };
        if (!entries.length) {
            return result;
        }
        const total = totalSize;
        let done = 0;
        for (const entry of entries) {
            progress.report({ work: { done, total } });
            const { file } = entry;
            let id: string | undefined;
            let readBytes = 0;
            let someAppendFailed: Error | undefined;
            try {
                const promises: Promise<void>[] = [];
                do {
                    const fileSlice = await this.readFileSlice(file, readBytes);
                    if (someAppendFailed) {
                        throw someAppendFailed;
                    }
                    checkCancelled(token);
                    readBytes = fileSlice.read;
                    if (id === undefined) {
                        id = await this.uploadServer.open(entry.uri.toString(), fileSlice.content, readBytes >= file.size);
                        checkCancelled(token);
                        progress.report({
                            work: {
                                done: done + fileSlice.read,
                                total
                            }
                        });
                    } else {
                        promises.push(this.uploadServer.append(id, fileSlice.content, readBytes >= file.size).then(() => {
                            checkCancelled(token);
                            progress.report({
                                work: {
                                    done: done + fileSlice.read,
                                    total
                                }
                            });
                        }, appendError => {
                            someAppendFailed = appendError;
                            throw appendError;
                        }));
                    }
                } while (readBytes < file.size);
                await Promise.all(promises);
                done += file.size;
                progress.report({ work: { done, total } });
            } finally {
                if (id !== undefined) {
                    this.uploadServer.close(id);
                }
            }
        }
        progress.report({ work: { done: total, total } });
        return result;
    }

    protected readFileSlice(file: File, read: number): Promise<{
        content: string
        read: number
    }> {
        return new Promise((resolve, reject) => {
            if (file.size === 0 && read === 0) {
                resolve({ content: '', read });
                return;
            }
            const bytesLeft = file.size - read;
            if (!bytesLeft) {
                reject(new Error('nothing to read'));
                return;
            }
            const size = Math.min(maxChunkSize, bytesLeft);
            const slice = file.slice(read, read + size);
            const reader = new FileReader();
            reader.onload = () => {
                read += size;
                const buffer = reader.result as ArrayBuffer;
                const content = base64.fromByteArray(new Uint8Array(buffer));
                resolve({ content, read });
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(slice);
        });
    }

    protected async withProgress<T>(
        cb: (progress: Progress, token: CancellationToken) => Promise<T>,
        { text }: FileUploadProgressParams = { text: 'Uploading Files...' }
    ): Promise<T> {
        const cancellationSource = new CancellationTokenSource();
        const { token } = cancellationSource;
        const progress = await this.messageService.showProgress({ text, options: { cancelable: true } }, () => cancellationSource.cancel());
        try {
            return await cb(progress, token);
        } finally {
            progress.cancel();
        }
    }

    protected async indexDataTransfer(targetUri: URI, dataTransfer: DataTransfer, context: FileUploadService.Context): Promise<void> {
        checkCancelled(context.token);
        if (dataTransfer.items) {
            await this.indexDataTransferItemList(targetUri, dataTransfer.items, context);
        } else {
            this.indexFileList(targetUri, dataTransfer.files, context);
        }
    }

    protected indexFileList(targetUri: URI, files: FileList, context: FileUploadService.Context): void {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file) {
                this.indexFile(targetUri, file, context);
            }
        }
    }

    protected indexFile(targetUri: URI, file: File, context: FileUploadService.Context): void {
        context.entries.push({
            uri: targetUri.resolve(file.name),
            file
        });
        context.totalSize += file.size;
    }

    protected async indexDataTransferItemList(targetUri: URI, items: DataTransferItemList, context: FileUploadService.Context): Promise<void> {
        checkCancelled(context.token);
        const promises: Promise<void>[] = [];
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry() as WebKitEntry;
            promises.push(this.indexEntry(targetUri, entry, context));
        }
        await Promise.all(promises);
    }

    protected async indexEntry(targetUri: URI, entry: WebKitEntry | null, context: FileUploadService.Context): Promise<void> {
        checkCancelled(context.token);
        if (!entry) {
            return;
        }
        if (entry.isDirectory) {
            await this.indexDirectoryEntry(targetUri, entry as WebKitDirectoryEntry, context);
        } else {
            await this.indexFileEntry(targetUri, entry as WebKitFileEntry, context);
        }
    }

    protected async indexDirectoryEntry(targetUri: URI, entry: WebKitDirectoryEntry, context: FileUploadService.Context): Promise<void> {
        checkCancelled(context.token);
        const newTargetUri = targetUri.resolve(entry.name);
        const promises: Promise<void>[] = [];
        await this.readEntries(entry, items => promises.push(this.indexEntries(newTargetUri, items, context)), context);
        await Promise.all(promises);
    }

    /**
     *  Read all entries within a folder by block of 100 files or folders until the
     *  whole folder has been read.
     */
    protected async readEntries(entry: WebKitDirectoryEntry, cb: (items: any) => void, context: FileUploadService.Context): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const reader = entry.createReader();
            const getEntries = () => reader.readEntries(results => {
                if (!context.token.isCancellationRequested && results && results.length) {
                    cb(results);
                    getEntries(); // loop to read all entries
                } else {
                    resolve();
                }
            }, reject);
            getEntries();
        });
    }

    protected async indexEntries(targetUri: URI, entries: WebKitEntry[], context: FileUploadService.Context): Promise<void> {
        checkCancelled(context.token);
        const promises: Promise<void>[] = [];
        for (let i = 0; i < entries.length; i++) {
            promises.push(this.indexEntry(targetUri, entries[i], context));
        }
        await Promise.all(promises);
    }

    protected async indexFileEntry(targetUri: URI, entry: WebKitFileEntry, context: FileUploadService.Context): Promise<void> {
        await new Promise((resolve, reject) => {
            try {
                entry.file(file => {
                    this.indexFile(targetUri, file, context);
                    resolve();
                }, reject);
            } catch (e) {
                reject(e);
            }
        });
    }

}

export namespace FileUploadService {
    export interface UploadEntry {
        file: File
        uri: URI
    }
    export interface Context {
        progress: Progress
        token: CancellationToken
        entries: UploadEntry[]
        totalSize: number

    }
    export interface Form {
        targetInput: HTMLInputElement
        fileInput: HTMLInputElement
        progress?: FileUploadProgressParams
    }
    export interface SubmitOptions {
        body: FormData
        token: CancellationToken
        onDidProgress: (event: ProgressEvent) => void
    }
    export interface SubmitError extends Error {
        status: number;
    }
    export function isSubmitError(e: any): e is SubmitError {
        return !!e && 'status' in e;
    }
}
