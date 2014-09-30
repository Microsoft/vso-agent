// 
// Copyright (c) Microsoft and contributors.  All rights reserved.
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//   http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// 
// See the License for the specific language governing permissions and
// limitations under the License.
// 

/// <reference path="./definitions/async.d.ts"/>

import async = require('async');
import ctxm = require('./context');
import dm = require('./diagnostics');
import fs = require('fs');
import ifm = require('./api/interfaces');
import lm = require('./logging');
import path = require('path');
import plgm = require('./plugins');
import tm = require('./tracing');

var shell = require('shelljs');

var trace: tm.Tracing;

//
// TODO: fix this for context API changes
//       get compiling
//       add more tracing
//       discuss ordering on log creation, associating timeline with logid
//
export class JobRunner {
	constructor(agCtx: ctxm.AgentContext, jobCtx: ctxm.JobContext) {
		this.agentContext = agCtx;
		trace = new tm.Tracing(__filename, agCtx);
		trace.enter('JobRunner');
		this.jobContext = jobCtx;
		this.job = jobCtx.job;		
	}

	private agentContext: ctxm.AgentContext;
	private jobContext: ctxm.JobContext;

	private job: ifm.JobRequestMessage;

	private _replaceTaskInputVars() {
		trace.enter('replaceTaskInputVars');

		// replace variables in inputs
		if (this.job.environment.variables) {
			this.job.tasks.forEach((task) => {
				trace.write(task.name);
				for (var key in task.inputs){
					task.inputs[key] = task.inputs[key].replaceVars(this.job.environment.variables);
				}
			});
		}
		trace.state('tasks', this.job.tasks);
	}

	public run(complete: (err:any, result: ifm.TaskResult) => void) {
		trace.enter('run');

		var ag = this.agentContext;
		this._replaceTaskInputVars();

		var _this: JobRunner = this;
		var jobCtx: ctxm.JobContext = this.jobContext;

		// prepare (might download) up to 5 tasks in parallel and then run tasks seuentially
		ag.status('Preparing Tasks');
		async.forEach(this.job.tasks, 
			function(pTask, callback){
				_this.prepareTask(pTask, callback);
			}, 
			function(err){
		        if (err) {
		        	trace.write('error preparing tasks');
		            complete(err, ifm.TaskResult.Failed);
		            return;
		        }
		        			
				ag.info('Task preparations complete.');

				// TODO: replace build with sender id once confirm how sent

				ag.info('loading plugins...');
				plgm.load('build', ag, (err:any, plugins:any) => {
					if (err) {
						trace.write('error loading plugins');
						complete(err, ifm.TaskResult.Failed);
						return;
					}

					//
					// Write out plug-ins and tasks we are about to run.
					// Create timeline entries for each in Pending state
					//
					ag.info('beforeJob Plugins:')
					plugins['beforeJob'].forEach(function(plugin) {
						ag.info(plugin.pluginName() + ":" + plugin.beforeId);
						jobCtx.registerPendingTask(plugin.beforeId, plugin.pluginName());
					});

					ag.info('tasks:')
					jobCtx.job.tasks.forEach(function(task) {
						ag.info(task.name + ":" + task.id);
						jobCtx.registerPendingTask(task.instanceId, task.name);
					});

					ag.info('afterJob Plugins:')
					plugins['afterJob'].forEach(function(plugin) {
						ag.info(plugin.name + ":" + plugin.afterId);
						jobCtx.registerPendingTask(plugin.afterId, plugin.pluginName());
					});

					ag.info('working: ' + jobCtx.workingFolder);
					shell.mkdir('-p', jobCtx.workingFolder);
					shell.cd(jobCtx.workingFolder);
					trace.write(process.cwd());

					var jobSuccess = true;
					async.series([
							function(done) {
								ag.info('Setting job to in progress');
								jobCtx.setJobInProgress();
								done(err);
							},
							function(done) {
								ag.info('Running beforeJob Plugins ...');
								plgm.beforeJob(plugins, jobCtx, ag, function(err, success) {
									ag.info('Finished running beforeJob plugins');
									trace.state('variables after plugins:', _this.job.environment.variables);

									// plugins can contribute to vars so replace again
									_this._replaceTaskInputVars();

									jobSuccess = !err && success;
									trace.write('jobSuccess: ' + jobSuccess);

									if (err) {
										ag.error(err);
									}

									// we always run afterJob plugins
									done(null);
								})
							},
							function(done) {
								// if prepare plugins fail, we should not run tasks (getting code failed etc...)
								if (!jobSuccess) {
									done(null);
								}

								ag.info('Running Tasks ...');
								_this.runTasks((err: any, success: boolean) => {
									ag.info('Finished running tasks');
									jobSuccess = jobSuccess && !err && success;
									trace.write('jobSuccess: ' + jobSuccess);

									if (err) {
										ag.error(err);
									}

									done(null);
								});
							},
							function(done) {
								ag.info('Running afterJob Plugins ...');
								plgm.afterJob(plugins, jobCtx, ag, jobSuccess, function(err, success) {
									ag.info('Finished running afterJob plugins');
									jobSuccess = jobSuccess && !err && success;
									trace.write('jobSuccess: ' + jobSuccess);

									if (err) {
										ag.error(err);
									}									
									done(err);
								});
							}			
						], 
						function(err) {
							var jobResult = jobSuccess ? ifm.TaskResult.Succeeded : ifm.TaskResult.Failed;
							trace.write('jobResult: ' + jobResult);

							if (err) {
								jobResult = ifm.TaskResult.Failed; 
							}

							complete(err, jobResult);
						});
				});

			})
	}

	private runTasks(callback: (err:any, success:boolean) => void): void {
		trace.enter('runTasks');

		var job: ifm.JobRequestMessage = this.job;
		var ag = this.agentContext;
		var jobCtx: ctxm.JobContext = this.jobContext;

		var success = true;
		var _this: JobRunner = this;

		trace.state('tasks', job.tasks);
		async.forEachSeries(job.tasks,
			function(item: ifm.TaskInstance, done: (err:any) => void){
				
				jobCtx.writeConsoleSection('Running ' + item.name);
				var taskCtx: ctxm.TaskContext = new ctxm.TaskContext(jobCtx.jobInfo, 
					                                                 item.instanceId,
					                                                 jobCtx.feedback, 
					                                                 ag);

				taskCtx.on('message', function(message) {
					jobCtx.feedback.queueConsoleLine(message);
				});

				shell.cd(taskCtx.workingFolder);
				jobCtx.setTaskStarted(item.instanceId, item.name);
				_this.runTask(item, taskCtx, function(err) {

					var taskResult: ifm.TaskResult = ifm.TaskResult.Succeeded;
					if (err || taskCtx.hasErrors) {
						success = false;
						taskResult = ifm.TaskResult.Failed;
					}

					trace.write('taskResult: ' + taskResult);
					jobCtx.setTaskResult(item.instanceId, item.name, taskResult);

					taskCtx.end();
					done(err);
				});
			}, function(err) {
				ag.info('Done running tasks.');
				trace.write('jobSucess: ' + success);

				if (err) {
	                ag.error(err.message);
	                callback(err, success);
	                return;		                
				}
				
				callback(null, success);
			});		
	}

	private taskExecution = {};
	private taskMetadata = {};

	private prepareTask(task: ifm.TaskInstance, callback) {
		trace.enter('prepareTask');

		var ag = this.agentContext;

		var taskPath = path.join(this.jobContext.workFolder, 'tasks', task.name, task.version);
		trace.write('taskPath: ' + taskPath);

		ag.info('preparing task ' + task.name);

		var taskJsonPath = path.join(taskPath, 'task.json');
		trace.write('taskJsonPath: ' + taskJsonPath);

		// TODO (bryanmac): support downloading - check if exists

		fs.readFile(taskJsonPath, 'utf8', (err, data) => {
			if (err) {
				trace.write('error reading: ' + taskJsonPath);
				callback(err);
				return;
			}

			// TODO: task metadata should be typed
			try {
				var taskMetadata = JSON.parse(data);
				trace.state('taskMetadata', taskMetadata);
				this.taskMetadata[task.id] = taskMetadata;

				var execution = taskMetadata.execution;

				var handlers = ['JavaScript', 'Python', 'ShellScript'];
				var instructions;
				handlers.some(function(handler) {
					if (execution.hasOwnProperty(handler)) {
						instructions = execution[handler];
						instructions["handler"] = handler;

						trace.write('handler: ' + handler);

						return true;
					}
				});
				
				if (!instructions) {
					trace.write('no handler for this task');
					callback(new Error('Agent could not find a handler for this task'));
					return;
				}

				instructions['target'] = path.join(taskPath, instructions.target);
				trace.state('instructions', instructions);
				this.taskExecution[task.id] = instructions;

				callback();
			}
			catch (e) {
				trace.write('exception getting metadata: ' + e.message);
				callback(new Error('Invalid metadata @ ' + taskJsonPath));
				return;
			}
		});
	}

	//
	// TODO: add beforeTask plugin step and move to their.  This is build specific code
	// and should not be in the generic agent code
	//
	private _processInputs(task: ifm.TaskInstance) {
		trace.enter('processInputs');

		//
		// Resolve paths for filePath inputs
		//
		var metadata = this.taskMetadata[task.id];
		trace.write('retrieved metadata for ' + task.name);

		var filePathInputs = {};
		metadata.inputs.forEach((input) => {
			trace.write('input ' + input.name + ' is type ' + input.type);
			if (input.type === 'filePath') {
				trace.write('adding ' + input.name);
				filePathInputs[input.name] = true;
			}
		});

		trace.state('filePathInputs', filePathInputs);
		var srcFolder = this.job.environment.variables['sys.sourceFolder'];
		trace.write('srcFolder: ' + srcFolder);

		for (var key in task.inputs){
			trace.write('checking ' + key);
			if (filePathInputs.hasOwnProperty(key)) {
				trace.write('rewriting value for ' + key);
				var resolvedPath = path.resolve(srcFolder, task.inputs[key]);
				trace.write('resolvedPath: ' + resolvedPath);
				task.inputs[key] = resolvedPath;
			}
			this.jobContext.verbose(key + ': ' + task.inputs[key]);
		}

		trace.state('task.inputs', task.inputs);
	}

	private runTask(task: ifm.TaskInstance, ctx: ctxm.TaskContext, callback) {
		trace.enter('runTask');
		var ag = this.agentContext;

		ag.status('Task: ' + task.name);

		this._processInputs(task);
		for (var key in task.inputs){
			ctx.verbose(key + ': ' + task.inputs[key]);
		}
		ctx.verbose('');
		ctx.inputs = task.inputs;

		var execution = this.taskExecution[task.id];
		trace.state('execution', execution);

		var handler = require('./handlers/' + execution.handler);
		ag.info('running ' + execution.target + ' with ' + execution.handler);

		trace.write('calling handler.runTask');
		handler.runTask(execution.target, ctx, callback);
	}	
}