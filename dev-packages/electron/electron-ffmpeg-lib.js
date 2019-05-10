#!/usr/bin/env node
// @ts-check
/********************************************************************************
 * Copyright (C) 2019 Ericsson and others.
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
'use-strict'

const path = require('path');

/**
 * @typedef {Object} File
 * @property {String} name
 * @property {String} [folder]
 */

/**
 * @param {NodeJS.Platform} [platform]
 * @return {File}
 */
exports.libffmpeg = function (platform) {
    if (!platform) platform = process.platform
    switch (platform) {
        case 'darwin':
            return {
                name: 'libffmpeg.dylib',
                folder: 'Electron.app/Contents/Frameworks/Electron Framework.framework/Libraries/',
            };
        case 'win32':
            return {
                name: 'ffmpeg.dll',
            };
        case 'linux':
            return {
                name: 'libffmpeg.so',
            };
        default:
            throw new Error(`${process.platform} is not supported`);
    }
}

/**
 * @param {libffmpegRelativePathOptions} [options]
 * @return {String}
 */
exports.libffmpegRelativePath = function ({ platform } = {}) {
    const libffmpeg = exports.libffmpeg(platform)
    return `${libffmpeg.folder || ''}${libffmpeg.name}`;
}

/**
 * @param {libffmpegAbsolutePathOptions} [options]
 * @return {String}
 */
exports.libffmpegAbsolutePath = function ({ platform, electronDist } = {}) {
    if (!electronDist) electronDist = path.dirname(require.resolve('electron/dist/electron'))
    return path.join(electronDist, exports.libffmpegRelativePath({ platform }))
}

/**
 * @typedef {Object} libffmpegRelativePathOptions
 * @property {NodeJS.Platform} [platform]
 */

/**
 * @typedef {Object} libffmpegAbsolutePathOptions
 * @property {NodeJS.Platform} [platform]
 * @property {String} [electronDist]
 */
