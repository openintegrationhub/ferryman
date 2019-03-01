const _ = require('lodash');
const amqp = require('../src/amqp.js');
const encryptor = require('../src/encryptor.js');
const Sailor = require('../src/sailor.js').Sailor;

process.env.ELASTICIO_TIMEOUT = 3000;

describe('Sailor', () => {
    const envVars = {};
    envVars.ELASTICIO_AMQP_URI = 'amqp://test2/test2';
    envVars.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
    envVars.ELASTICIO_STEP_ID = 'step_1';
    envVars.ELASTICIO_EXEC_ID = 'some-exec-id';

    envVars.ELASTICIO_USER_ID = '5559edd38968ec0736000002';
    envVars.ELASTICIO_COMP_ID = '5559edd38968ec0736000456';
    envVars.ELASTICIO_FUNCTION = 'list';

    envVars.ELASTICIO_LISTEN_MESSAGES_ON = '5559edd38968ec0736000003:step_1:1432205514864:messages';
    envVars.ELASTICIO_PUBLISH_MESSAGES_TO = 'userexchange:5527f0ea43238e5d5f000001';
    envVars.ELASTICIO_DATA_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:message';
    envVars.ELASTICIO_ERROR_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:error';
    envVars.ELASTICIO_REBOUND_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:rebound';
    envVars.ELASTICIO_SNAPSHOT_ROUTING_KEY = '5559edd38968ec0736000003:step_1:1432205514864:snapshot';

    envVars.ELASTICIO_COMPONENT_PATH = '/spec-jasmine/component';
    envVars.ELASTICIO_DEBUG = 'sailor';

    envVars.ELASTICIO_API_URI = 'http://apihost.com';
    envVars.ELASTICIO_API_USERNAME = 'test@test.com';
    envVars.ELASTICIO_API_KEY = '5559edd';

    let settings;

    const payload = { param1: 'Value1' };
    const message = {
        fields: {
            consumerTag: 'abcde',
            deliveryTag: 12345,
            exchange: 'test',
            routingKey: 'test.hello'
        },
        properties: {
            contentType: 'application/json',
            contentEncoding: 'utf8',
            headers: {
                taskId: '5559edd38968ec0736000003',
                execId: 'exec1',
                userId: '5559edd38968ec0736000002'
            },
            deliveryMode: undefined,
            priority: undefined,
            correlationId: undefined,
            replyTo: undefined,
            expiration: undefined,
            messageId: undefined,
            timestamp: undefined,
            type: undefined,
            userId: undefined,
            appId: undefined,
            mandatory: true,
            clusterId: ''
        },
        content: Buffer.from(encryptor.encryptMessageContent(payload))
    };

    beforeEach(() => {
        settings = require('../src/settings').readFrom(envVars);
    });

    describe('init', () => {
        it('should init properly if developer returned a plain string in init', async () => {
            settings.FUNCTION = 'init_trigger_returns_string';

            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            await sailor.prepare();
            const result = await sailor.init();

            expect(result).toEqual('this_is_a_string');
        });

        it('should init properly if developer returned a promise', async () => {
            settings.FUNCTION = 'init_trigger';

            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            await sailor.prepare();
            const result = await sailor.init();

            expect(result).toEqual({ subscriptionId: '_subscription_123' });
        });
    });

    describe('prepare', () => {
        let sailor;

        beforeEach(() => {
            sailor = new Sailor(settings);
        });

        describe('when step data retrieved', () => {
            let stepData;

            beforeEach(() => {
                stepData = { snapshot: {} };
            });

            describe(`when step data retreived`, () => {
                beforeEach(() => {
                    spyOn(sailor.componentReader, 'init').and.returnValue(Promise.resolve());
                    spyOn(sailor.apiClient.tasks, 'retrieveStep').and.returnValue(Promise.resolve(stepData));
                });

                it('should init component', async () => {
                    await sailor.prepare();

                    expect(sailor.stepData).toEqual(stepData);
                    expect(sailor.snapshot).toEqual(stepData.snapshot);
                    expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalledWith(settings.FLOW_ID, settings.STEP_ID);
                    expect(sailor.componentReader.init).toHaveBeenCalledWith(settings.COMPONENT_PATH);
                });
            });
        });

        describe('when step data is not retrieved', () => {
            beforeEach(() => {
                spyOn(sailor.apiClient.tasks, 'retrieveStep').and.returnValue(Promise.reject(new Error('failed')));
            });

            it('should fail', async () => {
                try {
                    await sailor.prepare();
                } catch (err) {
                    expect(err.message).toEqual('failed');
                }
            });
        });
    });

    describe('disconnection', () => {
        it('should disconnect Mongo and RabbitMQ, and exit process', async () => {
            const fakeAMQPConnection = jasmine.createSpyObj('AMQPConnection', ['disconnect']);
            fakeAMQPConnection.disconnect.and.returnValue(Promise.resolve());

            spyOn(amqp, 'Amqp').and.returnValue(fakeAMQPConnection);
            spyOn(process, 'exit').and.returnValue(0);

            const sailor = new Sailor(settings);

            await sailor.disconnect();
            expect(fakeAMQPConnection.disconnect).toHaveBeenCalled();
        });
    });

    describe('processMessage', () => {
        let fakeAMQPConnection;

        beforeEach(() => {
            fakeAMQPConnection = jasmine.createSpyObj('AMQPConnection', [
                'connect', 'sendData', 'sendError', 'sendRebound', 'ack', 'reject', 'sendSnapshot', 'sendHttpReply'
            ]);

            spyOn(amqp, 'Amqp').and.returnValue(fakeAMQPConnection);
        });

        it('should call sendData() and ack() if success', async () => {
            settings.FUNCTION = 'data_trigger';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendData).toHaveBeenCalled();

            const sendDataCalls = fakeAMQPConnection.sendData.calls;
            expect(sendDataCalls.argsFor(0)[0]).toEqual({ items: [1, 2, 3, 4, 5, 6] });
            expect(sendDataCalls.argsFor(0)[1]).toEqual(jasmine.any(Object));
            expect(sendDataCalls.argsFor(0)[1]).toEqual({
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    execId: 'exec1',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'data_trigger',
                    start: jasmine.any(Number),
                    cid: 1,
                    end: jasmine.any(Number),
                    messageId: jasmine.any(String)
                }
            });

            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should call sendData() and ack() only once', async () => {
            settings.FUNCTION = 'end_after_data_twice';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendData).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendData).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.reject).not.toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
        });

        it('should augment emitted message with passthrough data', async () => {
            settings.FUNCTION = 'passthrough';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({ is_passthrough: true });
            });

            const psPayload = {
                body: payload,
                passthrough: {
                    step_0: {
                        body: { key: 'value' }
                    }
                }
            };

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(psPayload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendData).toHaveBeenCalled();

            const sendDataCalls = fakeAMQPConnection.sendData.calls;

            expect(sendDataCalls.argsFor(0)[0]).toEqual({
                body: {
                    param1: 'Value1'
                },
                passthrough: {
                    step_0: {
                        body: {
                            key: 'value'
                        }
                    },
                    step_1: {
                        body: { param1: 'Value1' }
                    }
                }
            });
            expect(sendDataCalls.argsFor(0)[1]).toEqual(jasmine.any(Object));
            expect(sendDataCalls.argsFor(0)[1]).toEqual({
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    execId: 'exec1',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'passthrough',
                    start: jasmine.any(Number),
                    cid: 1,
                    end: jasmine.any(Number),
                    messageId: jasmine.any(String)
                }
            });

            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should send request to API server to update keys', async () => {
            settings.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            spyOn(sailor.apiClient.accounts, 'update').and.callFake((accountId, keys) => {
                expect(accountId).toEqual('1234567890');
                expect(keys).toEqual({ keys: { oauth: { access_token: 'newAccessToken' } } });
                return Promise.resolve();
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(sailor.apiClient.accounts.update).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).not.toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should emit error if failed to update keys', async () => {
            settings.FUNCTION = 'keys_trigger';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({
                    config: {
                        _account: '1234567890'
                    }
                });
            });

            spyOn(sailor.apiClient.accounts, 'update').and.callFake((accountId, keys) => {
                expect(accountId).toEqual('1234567890');
                expect(keys).toEqual({ keys: { oauth: { access_token: 'newAccessToken' } } });

                return Promise.reject(new Error('Update keys error'));
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(sailor.apiClient.accounts.update).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[0].message).toEqual('Update keys error');
            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should call sendRebound() and ack()', async () => {
            settings.FUNCTION = 'rebound_trigger';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendRebound).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendRebound.calls.argsFor(0)[0].message).toEqual('Rebound reason');
            expect(fakeAMQPConnection.sendRebound.calls.argsFor(0)[1]).toEqual(message);
            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should call sendSnapshot() and ack() after a `snapshot` event', async () => {
            settings.FUNCTION = 'update';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage({ snapshot: { blabla: 'blablabla' } }, message);

            const expectedSnapshot = { blabla: 'blablabla' };
            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendSnapshot).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.sendSnapshot.calls.argsFor(0)[0]).toEqual(expectedSnapshot);
            expect(fakeAMQPConnection.sendSnapshot.calls.argsFor(0)[1]).toEqual({
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    taskId: '5559edd38968ec0736000003',
                    execId: 'exec1',
                    userId: '5559edd38968ec0736000002',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'update',
                    start: jasmine.any(Number),
                    cid: 1,
                    snapshotEvent: 'snapshot',
                    messageId: jasmine.any(String)
                }
            });
            expect(sailor.snapshot).toEqual(expectedSnapshot);
            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should call sendSnapshot() and ack() after an `updateSnapshot` event', async () => {
            settings.FUNCTION = 'update';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({
                    snapshot: {
                        someId: 'someData'
                    }
                });
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage({ updateSnapshot: { updated: 'value' } }, message);

            const expectedSnapshot = { someId: 'someData', updated: 'value' };
            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendSnapshot).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.sendSnapshot.calls.argsFor(0)[0]).toEqual({ updated: 'value' });
            expect(fakeAMQPConnection.sendSnapshot.calls.argsFor(0)[1]).toEqual({
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    taskId: '5559edd38968ec0736000003',
                    execId: 'exec1',
                    userId: '5559edd38968ec0736000002',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'update',
                    start: jasmine.any(Number),
                    cid: 1,
                    snapshotEvent: 'updateSnapshot',
                    messageId: jasmine.any(String)
                }
            });
            expect(sailor.snapshot).toEqual(expectedSnapshot);
            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should send error if error happened', async () => {
            settings.FUNCTION = 'error_trigger';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[0].message).toEqual('Some component error');
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[0].stack).not.toBeUndefined();
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[2]).toEqual(message.content);
            expect(fakeAMQPConnection.reject).toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.reject.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should send error and reject only once()', async () => {
            settings.FUNCTION = 'end_after_error_twice';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack).not.toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).toHaveBeenCalledTimes(1);
        });

        it('should reject message if trigger is missing', async () => {
            settings.FUNCTION = 'missing_trigger';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[0].message).toMatch(/Failed to load file '.\/triggers\/missing_trigger.js': Cannot find module.+missing_trigger\.js/);
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[0].stack).not.toBeUndefined();
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[2]).toEqual(message.content);
            expect(fakeAMQPConnection.reject).toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.reject.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should not process message if taskId in header is not equal to task._id', async () => {
            const message2 = _.cloneDeep(message);
            message2.properties.headers.taskId = 'othertaskid';

            settings.FUNCTION = 'error_trigger';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message2);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).toHaveBeenCalled();
        });

        it('should catch all data calls and all error calls', async () => {
            settings.FUNCTION = 'datas_and_errors';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => {
                expect(taskId).toEqual('5559edd38968ec0736000003');
                expect(stepId).toEqual('step_1');
                return Promise.resolve({});
            });

            await sailor.prepare();
            await sailor.connect();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalled();
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendData).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendData).toHaveBeenCalledTimes(3);
            expect(fakeAMQPConnection.sendError).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError).toHaveBeenCalledTimes(2);
            expect(fakeAMQPConnection.reject).toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.reject.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should handle errors in httpReply properly', async () => {
            settings.FUNCTION = 'http_reply';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => Promise.resolve({}));

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalledWith('5559edd38968ec0736000003', 'step_1');
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendHttpReply).toHaveBeenCalled();

            const sendHttpReplyCalls = fakeAMQPConnection.sendHttpReply.calls;
            expect(sendHttpReplyCalls.argsFor(0)[0]).toEqual({
                statusCode: 200,
                body: 'Ok',
                headers: {
                    'content-type': 'text/plain'
                }
            });
            expect(sendHttpReplyCalls.argsFor(0)[1]).toEqual(jasmine.any(Object));
            expect(sendHttpReplyCalls.argsFor(0)[1]).toEqual({
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    execId: 'exec1',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'http_reply',
                    start: jasmine.any(Number),
                    cid: 1,
                    messageId: jasmine.any(String)
                }
            });
            expect(fakeAMQPConnection.sendData).toHaveBeenCalled();

            const sendDataCalls = fakeAMQPConnection.sendData.calls;
            expect(sendDataCalls.argsFor(0)[0]).toEqual({ body: {} });
            expect(sendDataCalls.argsFor(0)[1]).toEqual(jasmine.any(Object));
            expect(sendDataCalls.argsFor(0)[1]).toEqual({
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    execId: 'exec1',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'http_reply',
                    start: jasmine.any(Number),
                    cid: 1,
                    end: jasmine.any(Number),
                    messageId: jasmine.any(String)
                }
            });

            expect(fakeAMQPConnection.ack).toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.ack.calls.argsFor(0)[0]).toEqual(message);
        });

        it('should handle errors in httpReply properly', async () => {
            settings.FUNCTION = 'http_reply';
            const sailor = new Sailor(settings);

            spyOn(sailor.apiClient.tasks, 'retrieveStep').and.callFake((taskId, stepId) => Promise.resolve({}));

            const errorToThrow = new Error('Failed to send HTTP reply');
            fakeAMQPConnection.sendHttpReply.and.callFake(() => { throw errorToThrow; });

            await sailor.connect();
            await sailor.prepare();
            await sailor.processMessage(payload, message);

            expect(sailor.apiClient.tasks.retrieveStep).toHaveBeenCalledWith('5559edd38968ec0736000003', 'step_1');
            expect(fakeAMQPConnection.connect).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendHttpReply).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendHttpReply).toHaveBeenCalledWith({
                statusCode: 200,
                body: 'Ok',
                headers: {
                    'content-type': 'text/plain'
                }
            }, {
                contentType: 'application/json',
                contentEncoding: 'utf8',
                mandatory: true,
                headers: {
                    execId: 'exec1',
                    taskId: '5559edd38968ec0736000003',
                    userId: '5559edd38968ec0736000002',
                    stepId: 'step_1',
                    compId: '5559edd38968ec0736000456',
                    function: 'http_reply',
                    start: jasmine.any(Number),
                    cid: 1,
                    messageId: jasmine.any(String)
                }
            });

            expect(fakeAMQPConnection.sendData).not.toHaveBeenCalled();
            expect(fakeAMQPConnection.ack).not.toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError).toHaveBeenCalled();
            expect(fakeAMQPConnection.sendError.calls.argsFor(0)[0].message).toEqual('Failed to send HTTP reply');
            expect(fakeAMQPConnection.reject).toHaveBeenCalled();
            expect(fakeAMQPConnection.reject).toHaveBeenCalledTimes(1);
            expect(fakeAMQPConnection.reject).toHaveBeenCalledWith(message);
        });
    });

    describe('readIncomingMessageHeaders', () => {
        it('execId missing', () => {
            const sailor = new Sailor(settings);

            try {
                sailor.readIncomingMessageHeaders({
                    properties: {
                        headers: {}
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).toEqual('ExecId is missing in message header');
            }
        });

        it('taskId missing', () => {
            const sailor = new Sailor(settings);

            try {
                sailor.readIncomingMessageHeaders({
                    properties: {
                        headers: {
                            execId: 'my_exec_123'
                        }
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).toEqual('TaskId is missing in message header');
            }
        });

        it('userId missing', () => {
            const sailor = new Sailor(settings);

            try {
                sailor.readIncomingMessageHeaders({
                    properties: {
                        headers: {
                            execId: 'my_exec_123',
                            taskId: 'my_task_123'
                        }
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).toEqual('UserId is missing in message header');
            }
        });

        it('Message with wrong taskID arrived to the sailor', () => {
            const sailor = new Sailor(settings);

            try {
                sailor.readIncomingMessageHeaders({
                    properties: {
                        headers: {
                            execId: 'my_exec_123',
                            taskId: 'my_task_123',
                            userId: 'my_user_123'
                        }
                    }
                });
                throw new Error('Must not be reached');
            } catch (e) {
                expect(e.message).toEqual('Message with wrong taskID arrived to the sailor');
            }
        });

        it('should copy standard headers', () => {
            const sailor = new Sailor(settings);

            const headers = {
                execId: 'my_exec_123',
                taskId: settings.FLOW_ID,
                userId: 'my_user_123'
            };

            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).toEqual(headers);
        });

        it('should copy standard headers and parentMessageId', () => {
            const sailor = new Sailor(settings);

            const messageId = 'parent_message_1234';

            const headers = {
                execId: 'my_exec_123',
                taskId: settings.FLOW_ID,
                userId: 'my_user_123',
                messageId
            };

            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).toEqual({
                execId: 'my_exec_123',
                taskId: settings.FLOW_ID,
                userId: 'my_user_123',
                parentMessageId: messageId
            });
        });

        it('should copy standard headers and reply_to', () => {
            const sailor = new Sailor(settings);

            const headers = {
                execId: 'my_exec_123',
                taskId: settings.FLOW_ID,
                userId: 'my_user_123',
                reply_to: 'my_reply_to_exchange'
            };

            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).toEqual(headers);
        });

        it('should copy standard headers, reply_to and x-eio headers', () => {
            const sailor = new Sailor(settings);

            const headers = {
                'execId': 'my_exec_123',
                'taskId': settings.FLOW_ID,
                'userId': 'my_user_123',
                'reply_to': 'my_reply_to_exchange',
                'x-eio-meta-lowercase': 'I am lowercase',
                'X-eio-meta-miXeDcAse': 'Eventually to become lowercase'
            };

            const result = sailor.readIncomingMessageHeaders({
                properties: {
                    headers
                }
            });

            expect(result).toEqual({
                'execId': 'my_exec_123',
                'taskId': settings.FLOW_ID,
                'userId': 'my_user_123',
                'reply_to': 'my_reply_to_exchange',
                'x-eio-meta-lowercase': 'I am lowercase',
                'x-eio-meta-mixedcase': 'Eventually to become lowercase'
            });
        });
    });
});