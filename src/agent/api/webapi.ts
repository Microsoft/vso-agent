// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import baseifm = require('vso-node-api/interfaces/common/VsoBaseInterfaces');
import ifm = require('./interfaces');
import apivm = require('vso-node-api/handlers/apiversion');
import basicm = require('vso-node-api/handlers/basiccreds');
import bearm = require('vso-node-api/handlers/bearertoken');
import testm = require('./testmanagementapi');

export function versionHandler(apiVersion: string) {
	return new apivm.ApiVersionHandler(apiVersion);
}

export function basicHandler(username: string, password: string) {
	return new basicm.BasicCredentialHandler(username, password);
}

export function bearerHandler(token) {
	return new bearm.BearerCredentialHandler(token);
}

// ---------------------------------------------------------------------------
// factory to return hostapi (for building build host/agents) or buildapi (for querying and queuing builds)
//----------------------------------------------------------------------------

export function TestManagementApi(serverUrl: string, authHandler: baseifm.IRequestHandler): ifm.ITestManagementApi {
    return new testm.TestManagementApi(serverUrl, [authHandler, versionHandler('2.0-preview')]); 
}

export function QTestManagementApi(serverUrl: string, authHandler: baseifm.IRequestHandler): ifm.IQTestManagementApi {
    return new testm.QTestManagementApi(serverUrl, [authHandler, versionHandler('2.0-preview')]);
}