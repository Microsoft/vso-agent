// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

/// <reference path="./definitions/node.d.ts"/>
/// <reference path="./definitions/Q.d.ts" />

import Q = require('q');
import fs = require('fs');
import os = require('os');
import cm = require('./common');

var shell = require('shelljs');

/*
set env var for additional envvars to ignore sending as capabilities
export VSO_XPLAT_IGNORE=env1,env2
*/
var ignore = [
    'TERM_PROGRAM', 
    'TERM', 
    'TERM_PROGRAM_VERSION', 
    'SHLVL', 
    'ls_colors', 
    'comp_wordbreaks'
];

var getFilteredEnv = function(): { [key: string]: string } {
    var filter = ignore;
    if (process.env[cm.envIgnore]) {
        filter = filter.concat(process.env[cm.envIgnore].split(','));
    }
    
    var filtered: { [key: string]: string } = {};
    for (var envvar in process.env) {
        if (filter.indexOf(envvar) < 0 && process.env[envvar].length < 1024) {
            setCapability(filtered, envvar, process.env[envvar]);
        }
    }

    return filtered;
}

export function ensureEnvFile(envPath): Q.Promise<void> {
    var defer = Q.defer<void>();

    fs.exists(envPath, function(exists) {
        if (exists) {
            defer.resolve(null);
            return;
        };

        var vars: { [key: string]: string } = getFilteredEnv();

        var contents = "";
        for (var envvar in process.env) {
            contents += envvar + '=' + process.env[envvar] + os.EOL;
        }

        fs.writeFile(envPath, contents, 'utf8', (err) => {
            if (err) {
                defer.reject(new Error('Could not create env file: ' + err.message));
            }
            else {
                defer.resolve(null);
            } 
        });
    });  

    return defer.promise; 
}

//
// Get the env the agent and worker will use when run as a service (interactive is what it is)
// Defaults to this processes env but we'll overlay from file
//

export function getEnv(envPath: string, complete: (err: any, env: {[key: string]: string}) => void): void {
    var env: {[key: string]: string} = process.env;

    fs.exists(envPath, function(exists) {
        if (exists) {
            fs.readFile(envPath, function(err, data) {
                if (err) {
                    complete(err, null);
                    return;
                }

                var lines = data.toString('utf8').split(os.EOL);
                for (var lidx in lines) {
                    var line = lines[lidx];
                    var tokens = line.split('=');
                    if (tokens.length == 2) {
                        var envkey = tokens[0].trim();
                        var envval = tokens[1].trim();
                        if (envkey.length > 0 && envval.length > 0) {
                            env[envkey] = envval;
                        }
                    }
                }

                complete(null, env);
            });         
        }   
    });
}

// capability name is optional - defaults to tool name
var checkWhich = function(cap: any, tool: string, capability?:string) {
    var toolpath = shell.which(tool);
    if (toolpath) {
        setCapability(cap, capability || tool, toolpath);
    }   
}

var checkTool = function(cap: any, command: string, args: string, capability: string) {
    var tool = shell.which(command);
    if (!tool) {
        return;
    }

    var val = shell.exec(command + ' ' + args, {silent:true}).output;
    if (val) {
        setCapability(cap, capability, val);
    }
}

var setIfNot = function(cap, name, val) {
    if (!cap.hasOwnProperty(name.trim())) {
        cap[name.trim()] = val;
    }   
}

var setCapability = function (cap: cm.IStringDictionary, name: string, val: string) {
    cap[name.trim()] = val;
}

export function getCapabilities(): cm.IStringDictionary {
    var cap: cm.IStringDictionary = getFilteredEnv();

    checkWhich(cap, 'sh');
    checkWhich(cap, 'git');
    checkWhich(cap, 'npm');
    checkWhich(cap, 'node', 'node.js');
    checkWhich(cap, 'nodejs', 'node.js');
    checkWhich(cap, 'python');
    checkWhich(cap, 'python3');
    
    // we check for jake globally installed for path but if not, we package jake as part of this agent
    checkWhich(cap, 'jake');
    setIfNot(cap, 'jake', '.');

    checkWhich(cap, 'ant');
    checkWhich(cap, 'cmake');
    checkWhich(cap, 'java');
    checkWhich(cap, 'mvn', 'maven');
    checkTool(cap, 'xcode-select', '-p', 'xcode');

    // For Xamarin.iOS, check for mdtool in the path.
    // Since the Xamarin installer does not add it to the path,
    // if it is not found in the path, check its default install location.
    var xamariniOSCapability = 'Xamarin.iOS';
    checkWhich(cap, 'mdtool', xamariniOSCapability);
    if (!cap.hasOwnProperty(xamariniOSCapability)) {
        var mdtoolInstallPath = '/Applications/Xamarin Studio.app/Contents/MacOS/mdtool';
        if (fs.existsSync(mdtoolInstallPath)) {
            cap[xamariniOSCapability] = mdtoolInstallPath;
        }
    }

    return cap;
}
