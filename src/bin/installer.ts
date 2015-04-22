// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

var shell = require('shelljs');
var path = require('path');

var installDir = path.join(__dirname, '..');
var agentDir = path.join(installDir, 'agent');
var targetDir = process.cwd();

console.log('Installing agent to ' + targetDir);

// ensure clean in case update
var agentTarget = path.join(targetDir, 'agent');
if (shell.test('-d', agentTarget)) {
	console.log('updating agent.  removing old code.')
	shell.rm('-rf', agentTarget);
}

var modsTarget = path.join(targetDir, 'node_modules');
if (shell.test('-d', modsTarget)) {
	console.log('updating node modules.  removing old modules.')
	shell.rm('-rf', modsTarget);
}

var pkgTarget = path.join(targetDir, 'package.json');
if (shell.test('-f', pkgTarget)) {
	console.log('updating agent.  removing old package.json')
	shell.rm('-f', pkgTarget);
}

// copy new bits
console.log('Copying: ', agentDir, targetDir);
shell.cp('-R', agentDir, targetDir);

var modsDir = path.join(installDir, 'node_modules');
var targetAgent = path.join(targetDir, 'agent');
console.log('Copying: ', modsDir, targetDir);
shell.cp('-R', modsDir, targetDir);
shell.cp(path.join(installDir, 'package.json'), targetDir);

console.log('making scripts executable')
shell.chmod('u+x', path.join(targetAgent, 'svc.sh'));
shell.chmod('u+x', path.join(targetAgent, 'plugins/build/lib/askpass.js'));

console.log('Done.');