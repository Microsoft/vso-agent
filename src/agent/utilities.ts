// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

/// <reference path="./definitions/Q.d.ts" />

import Q = require('q');
import ctxm = require('./context');
import fs = require('fs');

var shell = require('shelljs');
var path = require('path');
var archiver = require('archiver');

export interface GetOrCreateResult<T> {
    created: boolean;
    result: T;
}

//converts inputString to titleCase string. For example, "abc def" is converted to "Abc Def"
export function toTitleCase(inputString: string): string {
    if (inputString) {
        return inputString.replace(/\w\S*/g, function(str) { return str.charAt(0).toUpperCase() + str.substr(1).toLowerCase(); });
    }
    return inputString;
}
   
// returns a substring that is common from first. For example, for "abcd" and "abdf", "ab" is returned.
export function sharedSubString(string1: string, string2: string): string {
    var ret = "";
    var index = 1;
    while (string1.substring(0, index) == string2.substring(0, index)) {
        ret = string1.substring(0, index);
        index++;
    }
    return ret;
}
    
// sorts string array in ascending order
export function sortStringArray(list): string[] {
    var sortedFiles: string[] = list.sort((a, b) => {
        if (a > b) {
            return 1;
        }
        else if (a < b) {
            return -1;
        }
        else {
            return 0;
        }
    });
    return sortedFiles;
}

// returns true if path exists and it is a directory else false.
export function isDirectoryExists(path: string): boolean {
    try {
        return fs.lstatSync(path).isDirectory();
    }
    catch (error) {
        return false;
    }
}

// returns true if path exists and it is a file else false.
export function isFileExists(path: string): boolean {
    try {
        return fs.lstatSync(path).isFile();
    }
    catch (error) {
        return false;
    }
}


// TODO: offer these module level context-less helper functions in utilities below
export function ensurePathExists(path: string): Q.Promise<void> {
    var defer = Q.defer<void>();

    fs.exists(path, (exists) => {
        if (!exists) {
            shell.mkdir('-p', path);

            var errMsg = shell.error();

            if (errMsg) {
                defer.reject(new Error('Could not create path (' + path + '): ' + errMsg));
            }
            else {
                defer.resolve(null);
            }
        }
        else {
            defer.resolve(null);
        }
    });

    return defer.promise;
}

export function readFileContents(filePath: string, encoding: string): Q.Promise<string> {
    var defer = Q.defer<string>();

    fs.readFile(filePath, encoding, (err, data) => {
        if (err) {
            defer.reject(new Error('Could not read file (' + filePath + '): ' + err.message));
        }
        else {
            defer.resolve(data);
        }
    });

    return defer.promise;
}

export function fileExists(filePath: string): Q.Promise<boolean> {
    var defer = Q.defer<boolean>();

    fs.exists(filePath, (exists) => {
        defer.resolve(exists);
    });

    return <Q.Promise<boolean>>defer.promise;
}
export function objectToFile(filePath: string, obj: any): Q.Promise<void> {
    var defer = Q.defer<void>();

    fs.writeFile(filePath, JSON.stringify(obj, null, 2), (err) => {
        if (err) {
            defer.reject(new Error('Could not save to file (' + filePath + '): ' + err.message));
        }
        else {
            defer.resolve(null);
        }
    });

    return defer.promise;
}

export function objectFromFile(filePath: string, defObj?: any): Q.Promise<any> {
    var defer = Q.defer<any>();

    fs.exists(filePath, (exists) => {
        if (!exists && defObj) {
            defer.resolve(defObj);
        }
        else if (!exists) {
            defer.reject(new Error('File does not exist: ' + filePath));
        }
        else {
            fs.readFile(filePath, (err, contents) => {
                if (err) {
                    defer.reject(new Error('Could not read file (' + filePath + '): ' + err.message));
                }
                else {
                    var obj: any = JSON.parse(contents.toString());
                    defer.resolve(obj);
                }
            });
        }
    })

    return defer.promise;
}

export function getOrCreateObjectFromFile<T>(filePath: string, defObj: T): Q.Promise<GetOrCreateResult<T>> {
    var defer = Q.defer<GetOrCreateResult<T>>();

    fs.exists(filePath, (exists) => {
        if (!exists) {
            fs.writeFile(filePath, JSON.stringify(defObj, null, 2), (err) => {
                if (err) {
                    defer.reject(new Error('Could not save to file (' + filePath + '): ' + err.message));
                }
                else {
                    defer.resolve({
                        created: true,
                        result: defObj
                    });
                }
            });
        }
        else {
            fs.readFile(filePath, (err, contents) => {
                if (err) {
                    defer.reject(new Error('Could not read file (' + filePath + '): ' + err.message));
                }
                else {
                    var obj: any = JSON.parse(contents.toString());
                    defer.resolve({
                        created: false,
                        result: obj
                    });
                }
            });
        }
    })

    return defer.promise;
}

// ret is { output: string, code: number }
export function exec(cmdLine: string): Q.Promise<any> {
    var defer = Q.defer<any>();

    shell.exec(cmdLine, (code, output) => {
        defer.resolve({ code: code, output: output });
    });

    return defer.promise;
}

export enum SearchOption {
    TopDirectoryOnly = 0,
    AllDirectories = 1,
}

export function readDirectory(directory: string, includeFiles: boolean, includeFolders: boolean, searchOption?: SearchOption): Q.Promise<string[]> {
    var results: string[] = [];
    var deferred = Q.defer<string[]>();

    if (includeFolders) {
        results.push(directory);
    }

    Q.nfcall(fs.readdir, directory)
        .then((files: string[]) => {
            var count = files.length;
            if (count > 0) {
                files.forEach((file: string, index: number) => {
                    var fullPath = path.join(directory, file);
                    Q.nfcall(fs.stat, fullPath)
                        .then((stat: fs.Stats) => {
                            if (stat && stat.isDirectory()) {
                                if (SearchOption.TopDirectoryOnly === searchOption) {
                                    results.push(fullPath);
                                    if (--count === 0) {
                                        deferred.resolve(results);
                                    }
                                }
                                else {
                                    readDirectory(fullPath, includeFiles, includeFolders, searchOption)
                                        .then((moreFiles: string[]) => {
                                            results = results.concat(moreFiles);
                                            if (--count === 0) {
                                                deferred.resolve(results);
                                            }
                                        },
                                        (error) => {
                                            deferred.reject(new Error(error.toString()));
                                        });
                                }
                            }
                            else {
                                if (includeFiles) {
                                    results.push(fullPath);
                                }
                                if (--count === 0) {
                                    deferred.resolve(results);
                                }
                            }
                        });
                });
            }
            else {
                deferred.resolve(results);
            }
        },
        (error) => {
            deferred.reject(error);
        });

    return deferred.promise;
}

export function archiveFiles(files: string[], archiveName: string): Q.Promise<string> {
    var defer = Q.defer<string>();
    var archive = path.join(shell.tempdir(), archiveName);
    var output = fs.createWriteStream(archive);
    var zipper = archiver('zip');

    output.on('close', function() {
        defer.resolve(archive);
    });
    zipper.on('error', function(err) {
        defer.reject(err);
    });

    zipper.pipe(output);
    zipper.bulk([{ src: files, expand: true }]);
    zipper.finalize(function(err, bytes) {
        if (err) {
            defer.reject(err);
        }
    });

    return defer.promise;
}

//
// Utilities passed to each task
// which provides contextual logging to server etc...
// also contains general utility methods that would be useful to all task authors
//
export class Utilities {
    constructor(context: ctxm.Context) {
        this.ctx = context;
    }

    private ctx: ctxm.Context;

    //
    // '-a -b "quoted b value" -c -d "quoted d value"' becomes
    // [ '-a', '-b', '"quoted b value"', '-c', '-d', '"quoted d value"' ]
    //
    public argStringToArray(argString: string): string[] {
        var args = argString.match(/([^" ]*("[^"]*")[^" ]*)|[^" ]+/g);
        //remove double quotes from each string in args as child_process.spawn() cannot handle literla quotes as part of arguments
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i].replace(/"/g, "");
        }
        return args;
    }
    
    // spawn a process with stdout/err piped to context's logger
    // callback(err)
    public spawn(name: string, args: string[], options, callback: (err: any, returnCode: number) => void) {
        var failed = false;
        options = options || {};
        args = args || [];

        var ops = {
            cwd: process.cwd(),
            env: process.env,
            failOnStdErr: true,
            failOnNonZeroRC: true
        };

        // write over specified options over default options (ops)
        for (var op in options) {
            ops[op] = options[op];
        }

        this.ctx.verbose('cwd: ' + ops.cwd);
        this.ctx.verbose('args: ' + args.toString());
        this.ctx.info('running: ' + name + ' ' + args.join(' '));

        var cp = require('child_process').spawn;

        var runCP = cp(name, args, ops);

        runCP.stdout.on('data', (data) => {
            this.ctx.info(data.toString('utf8'));
        });

        runCP.stderr.on('data', (data) => {
            failed = ops.failOnStdErr;
            if (ops.failOnStdErr) {
                this.ctx.error(data.toString('utf8'));
            } else {
                this.ctx.info(data.toString('utf8'));
            }
        });

        runCP.on('exit', (code) => {
            if (failed) {
                callback(new Error('Failed with Error Output'), code);
                return;
            }

            if (code == 0 || !ops.failOnNonZeroRC) {
                callback(null, code);
            } else {
                var msg = path.basename(name) + ' returned code: ' + code;
                callback(new Error(msg), code);
            }
        });
    }
}
