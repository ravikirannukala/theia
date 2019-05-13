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

import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import { injectable } from 'inversify';
import { FileUri } from '@theia/core/lib/node/file-uri';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileUploadServer } from '../common/file-upload-server';

@injectable()
export class NodeFileUploadServer implements FileUploadServer {

    protected readonly toDispose = new DisposableCollection();
    protected readonly uploads = new Map<string, NodeFileUpload>();

    dispose(): void {
        this.toDispose.dispose();
    }

    async open(uri: string, content: string, done: boolean): Promise<string> {
        const upload = new NodeFileUpload(FileUri.fsPath(uri));
        this.toDispose.push(upload);
        this.uploads.set(upload.id, upload);
        this.toDispose.push(Disposable.create(() => this.uploads.delete(upload.id)));
        await upload.create(content);
        if (done) {
            await upload.rename();
            await this.close(upload.id);
        }
        return upload.id;
    }

    async append(id: string, content: string, done: boolean): Promise<void> {
        const upload = this.uploads.get(id);
        if (!upload) {
            throw new Error(`upload '${id}' does not exist`);
        }
        await upload.append(content);
        if (done) {
            await upload.rename();
            await this.close(upload.id);
        }
    }

    async close(id: string): Promise<void> {
        const upload = this.uploads.get(id);
        if (upload) {
            upload.dispose();
        }
    }

}

export class NodeFileUpload implements Disposable {

    readonly id: string;
    readonly uploadPath: string;

    constructor(
        readonly fsPath: string
    ) {
        this.id = 'upload_' + crypto.randomBytes(16).toString('hex');
        this.uploadPath = path.join(path.dirname(fsPath), this.id);
    }

    async create(content: string): Promise<void> {
        await fs.outputFile(this.uploadPath, content, 'base64');
    }

    async append(content: string): Promise<void> {
        await fs.appendFile(this.uploadPath, content, { encoding: 'base64' });
    }

    async rename(): Promise<void> {
        await fs.move(this.uploadPath, this.fsPath, { overwrite: true });
        this.dispose = () => Promise.resolve();
    }

    dispose(): void {
        fs.unlink(this.uploadPath).catch(() => {/*no-op*/ });
    }

}
