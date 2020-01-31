'use strict';

const nock = require('nock');
const expect = require('chai').expect;
const co = require('co');
const sinonjs = require('sinon');
const logging = require('../lib/logging.js');
const helpers = require('./integration_helpers');

const env = process.env;

describe('Integration Test', () => {
    const customers = [
        {
            name: 'Homer Simpson'
        },
        {
            name: 'Marge Simpson'
        }
    ];
    const inputMessage = {
        headers: {
            stepId: 'step_1'
        },
        body: {
            message: 'Just do it!'
        }
    };

    let run;

    beforeEach(() => {
        helpers.prepareEnv();
        env.ELASTICIO_FUNCTION = 'init_trigger';
    });

    afterEach((done) => {
        delete env.ELASTICIO_STARTUP_REQUIRED;
        delete env.ELASTICIO_FUNCTION;
        delete env.ELASTICIO_HOOK_SHUTDOWN;

        co(function* gen() {
            yield run._disconnectOnly();
            done();
        }).catch(done);

        nock.cleanAll();
    });

    let sinon;
    beforeEach(() => {
        sinon = sinonjs.sandbox.create();
    });
    afterEach(() => {
        sinon.restore();
    });

    describe('when sailor is being invoked for message processing', () => {
        const parentMessageId = 'parent_message_1234567890';
        const threadId = helpers.PREFIX + '_thread_id_123456';
        const messageId = 'f45be600-f770-11e6-b42d-b187bfbf19fd';

        let amqpHelper = helpers.amqp();
        beforeEach(() => amqpHelper.prepare());
        afterEach(() => amqpHelper.cleanUp());

        it('should run trigger successfully', (done) => {
            helpers.mockApiTaskStepResponse();

            nock('https://api.acme.com')
                .post('/subscribe')
                .reply(200, {
                    id: 'subscription_12345'
                })
                .get('/customers')
                .reply(200, customers);

            amqpHelper.on('data', ({ properties, body }, queueName) => {
                expect(queueName).to.eql(amqpHelper.nextStepQueue);

                delete properties.headers.start;
                delete properties.headers.end;
                delete properties.headers.cid;

                expect(properties.headers).to.deep.equal({
                    execId: env.ELASTICIO_EXEC_ID,
                    taskId: env.ELASTICIO_FLOW_ID,
                    workspaceId: env.ELASTICIO_WORKSPACE_ID,
                    containerId: env.ELASTICIO_CONTAINER_ID,
                    userId: env.ELASTICIO_USER_ID,
                    stepId: env.ELASTICIO_STEP_ID,
                    compId: env.ELASTICIO_COMP_ID,
                    function: env.ELASTICIO_FUNCTION,
                    threadId,
                    parentMessageId: parentMessageId,
                    messageId
                });

                delete properties.headers;

                expect(properties).to.deep.equal({
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
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
                    clusterId: undefined
                });

                expect(body).to.deep.equal({
                    originalMsg: inputMessage,
                    customers: customers,
                    subscription: {
                        id: 'subscription_12345',
                        cfg: {
                            apiKey: 'secret'
                        }
                    }
                });

            }, done);

            run = requireRun();

            amqpHelper.publishMessage(inputMessage, {
                parentMessageId,
                threadId
            });
        });

        it('should augment passthrough property with data', done => {
            process.env.ELASTICIO_STEP_ID = 'step_2';
            process.env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
            process.env.ELASTICIO_FUNCTION = 'emit_data';

            helpers.mockApiTaskStepResponse({
                is_passthrough: true
            });

            const psMsg = Object.assign(inputMessage, {
                passthrough: {
                    step_1: { // emulating an another step – just to be sure that it's not lost
                        id: '34',
                        body: {},
                        attachments: {}
                    }
                }
            });

            amqpHelper.publishMessage(psMsg, {
                parentMessageId,
                threadId
            });

            amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {
                expect(queueName).to.eql(amqpHelper.nextStepQueue);

                expect(emittedMessage.passthrough).to.deep.eql({
                    step_1: { // emulating an another step – just to be sure that it's not lost
                        id: '34',
                        body: {},
                        attachments: {}
                    },
                    step_2: {
                        id: messageId,
                        headers: {
                            'x-custom-component-header': '123_abc'
                        },
                        body: {
                            id: 'someId',
                            hai: 'there'
                        }
                    }
                });

                delete properties.headers.start;
                delete properties.headers.end;
                delete properties.headers.cid;

                expect(properties.headers).to.deep.equal({
                    taskId: env.ELASTICIO_FLOW_ID,
                    execId: env.ELASTICIO_EXEC_ID,
                    workspaceId: env.ELASTICIO_WORKSPACE_ID,
                    containerId: env.ELASTICIO_CONTAINER_ID,
                    userId: env.ELASTICIO_USER_ID,
                    threadId,
                    stepId: env.ELASTICIO_STEP_ID,
                    compId: env.ELASTICIO_COMP_ID,
                    function: env.ELASTICIO_FUNCTION,
                    messageId,
                    parentMessageId
                });

                delete properties.headers;

                expect(properties).to.deep.eql({
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
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
                    clusterId: undefined
                });
            }, done);

            run = requireRun();
        });

        it(
            'should paste data from incoming message into passthrough and not copy own data if NO_SELF_PASSTRHOUGH',
            done => {
                process.env.ELASTICIO_STEP_ID = 'step_2';
                process.env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
                process.env.ELASTICIO_FUNCTION = 'emit_data';
                process.env.ELASTICIO_NO_SELF_PASSTRHOUGH = 'true';

                helpers.mockApiTaskStepResponse({
                    is_passthrough: true
                });

                const psMsg = Object.assign(inputMessage, {
                    passthrough: {
                        step_oth: { // emulating an another step – just to be sure that it's not lost
                            id: 'id-56',
                            body: { a: 1 },
                            attachments: {}
                        }
                    }
                });

                amqpHelper.publishMessage(psMsg, {
                    parentMessageId,
                    threadId
                });

                amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    expect(emittedMessage.passthrough).to.deep.eql({
                        step_oth: { // emulating an another step – just to be sure that it's not lost
                            id: 'id-56',
                            body: { a: 1 },
                            attachments: {}
                        },
                        step_1: {
                            headers: inputMessage.headers,
                            body: inputMessage.body
                        }
                    });

                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;

                    expect(properties.headers).to.deep.equal({
                        taskId: env.ELASTICIO_FLOW_ID,
                        execId: env.ELASTICIO_EXEC_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        threadId,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        messageId,
                        parentMessageId
                    });

                    delete properties.headers;

                    expect(properties).to.deep.eql({
                        contentType: 'application/json',
                        contentEncoding: 'utf8',
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
                        clusterId: undefined
                    });
                }, done);

                run = requireRun();
            }
        );

        it('should work well with async process function emitting data', done => {
            process.env.ELASTICIO_STEP_ID = 'step_2';
            process.env.ELASTICIO_FLOW_ID = '5559edd38968ec0736000003';
            process.env.ELASTICIO_FUNCTION = 'async_trigger';
            process.env.ELASTICIO_DATA_RATE_LIMIT = '1';
            process.env.ELASTICIO_RATE_INTERVAL = '110';

            helpers.mockApiTaskStepResponse({
                is_passthrough: true
            });

            const psMsg = Object.assign(inputMessage, {
                passthrough: {
                    step_oth: { // emulating an another step – just to be sure that it's not lost
                        id: 'm-34',
                        body: {},
                        attachments: {}
                    }
                },
                headers: {
                    'x-custom-component-header': '123_abc',
                    'stepId': 'step_1'
                }
            });

            amqpHelper.publishMessage(psMsg, {
                parentMessageId,
                threadId
            });

            let counter = 0;
            const start = Date.now();
            amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {

                expect(queueName).to.eql(amqpHelper.nextStepQueue);

                expect(emittedMessage.passthrough).to.deep.eql({
                    step_oth: { // emulating an another step – just to be sure that it's not lost
                        id: 'm-34',
                        body: {},
                        attachments: {}
                    },
                    step_1: {
                        headers: {
                            'x-custom-component-header': '123_abc',
                            'stepId': 'step_1'
                        },
                        body: {
                            message: 'Just do it!'
                        }
                    }
                });


                delete properties.headers.start;
                delete properties.headers.end;
                delete properties.headers.cid;

                expect(properties.headers).to.deep.equal({
                    taskId: env.ELASTICIO_FLOW_ID,
                    execId: env.ELASTICIO_EXEC_ID,
                    workspaceId: env.ELASTICIO_WORKSPACE_ID,
                    containerId: env.ELASTICIO_CONTAINER_ID,
                    userId: env.ELASTICIO_USER_ID,
                    threadId,
                    stepId: env.ELASTICIO_STEP_ID,
                    compId: env.ELASTICIO_COMP_ID,
                    function: env.ELASTICIO_FUNCTION,
                    messageId,
                    parentMessageId
                });

                delete properties.headers;

                expect(properties).to.deep.eql({
                    contentType: 'application/json',
                    contentEncoding: 'utf8',
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
                    clusterId: undefined
                });
            }, () => {
                counter++;
                // We need 10 messages
                if (counter > 10) {
                    const duration = Date.now() - start;
                    console.log(`Test duration was ${duration} milliseconds, it should be more than 1000`);
                    expect(duration > 1000).to.be.ok;
                    done();
                }
            });

            run = requireRun();
        });

        describe('when env ELASTICIO_STARTUP_REQUIRED is set', () => {
            beforeEach(() => {
                env.ELASTICIO_STARTUP_REQUIRED = '1';
            });

            describe('when hooks data for the task is not created yet', () => {
                it('should execute startup successfully', (done) => {
                    let startupRegistrationRequest;
                    const startupRegistrationNock = nock('http://example.com/')
                        .post('/subscriptions/enable')
                        .reply(200, (uri, requestBody) => {
                            startupRegistrationRequest = requestBody;
                            return {
                                status: 'ok'
                            };
                        });

                    helpers.mockApiTaskStepResponse();

                    // sailor persists startup data via sailor-support API
                    let hooksDataRequest;
                    const hooksDataNock = nock(env.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {
                            subscriptionResult: {
                                status: 'ok'
                            }
                        })
                        .reply(201, (uri, requestBody) => {
                            hooksDataRequest = requestBody;
                            return requestBody;
                        });

                    // response for a subscription request, which performed inside of init method
                    nock('https://api.acme.com')
                        .post('/subscribe')
                        .reply(200, {
                            id: 'subscription_12345'
                        })
                        .get('/customers')
                        .reply(200, customers);

                    amqpHelper.on('data', ({ properties, body }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        expect(startupRegistrationRequest).to.deep.equal({
                            data: 'startup'
                        });

                        expect(hooksDataRequest).to.deep.equal({
                            subscriptionResult: {
                                status: 'ok'
                            }
                        });

                        expect(startupRegistrationNock.isDone()).to.be.ok;
                        expect(hooksDataNock.isDone()).to.be.ok;

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: env.ELASTICIO_EXEC_ID,
                            taskId: env.ELASTICIO_FLOW_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION,
                            messageId
                        });

                        expect(body).to.deep.equal({
                            originalMsg: inputMessage,
                            customers: customers,
                            subscription: {
                                id: 'subscription_12345',
                                cfg: {
                                    apiKey: 'secret'
                                }
                            }
                        });
                    }, done);

                    run = requireRun();

                    amqpHelper.publishMessage(inputMessage);
                });
            });

            describe('when hooks data already exists', () => {
                it('should delete previous data and execute startup successfully', (done) => {
                    let startupRegistrationRequest;
                    const startupRegistrationNock = nock('http://example.com/')
                        .post('/subscriptions/enable')
                        .reply(200, (uri, requestBody) => {
                            startupRegistrationRequest = requestBody;
                            return {
                                status: 'ok'
                            };
                        });

                    helpers.mockApiTaskStepResponse();

                    let hooksDataRequest1;
                    let hooksDataRequest2;

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock1 = nock(env.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {
                            subscriptionResult: {
                                status: 'ok'
                            }
                        })
                        .reply(409, (uri, requestBody) => {
                            hooksDataRequest1 = requestBody;
                            return {
                                error: 'Hooks data for the task already exist. Delete previous data first.',
                                status: 409,
                                title: 'ConflictError'
                            };
                        });

                    // sailor removes data in order to resolve conflict
                    const hooksDataDeleteNock = nock(env.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                        .reply(204);

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock2 = nock(env.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {
                            subscriptionResult: {
                                status: 'ok'
                            }
                        })
                        .reply(201, (uri, requestBody) => {
                            hooksDataRequest2 = requestBody;
                            return requestBody;
                        });

                    // response for a subscription request, which performed inside of init method
                    nock('https://api.acme.com')
                        .post('/subscribe')
                        .reply(200, {
                            id: 'subscription_12345'
                        })
                        .get('/customers')
                        .reply(200, customers);

                    amqpHelper.on('data', ({ properties, body }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        expect(startupRegistrationRequest).to.deep.equal({
                            data: 'startup'
                        });

                        expect(startupRegistrationNock.isDone()).to.be.ok;
                        expect(hooksDataNock1.isDone()).to.be.ok;
                        expect(hooksDataNock2.isDone()).to.be.ok;
                        expect(hooksDataDeleteNock.isDone()).to.be.ok;

                        expect(hooksDataRequest1).to.deep.equal({
                            subscriptionResult: {
                                status: 'ok'
                            }
                        });

                        expect(hooksDataRequest2).to.deep.equal({
                            subscriptionResult: {
                                status: 'ok'
                            }
                        });

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: env.ELASTICIO_EXEC_ID,
                            taskId: env.ELASTICIO_FLOW_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION,
                            messageId
                        });

                        expect(body).to.deep.equal({
                            originalMsg: inputMessage,
                            customers: customers,
                            subscription: {
                                id: 'subscription_12345',
                                cfg: {
                                    apiKey: 'secret'
                                }
                            }
                        });
                    }, done);

                    run = requireRun();

                    amqpHelper.publishMessage(inputMessage);
                });
            });

            describe('when startup method returns empty data', () => {
                it('should store an empty object as data and execute trigger successfully', (done) => {
                    let startupRegistrationRequest;

                    env.ELASTICIO_FUNCTION = 'startup_with_empty_data';

                    const startupRegistrationNock = nock('http://example.com/')
                        .post('/subscriptions/enable')
                        .reply(200, (uri, requestBody) => {
                            startupRegistrationRequest = requestBody;
                            return {
                                status: 'ok'
                            };
                        });

                    helpers.mockApiTaskStepResponse();

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock = nock(env.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {})
                        .reply(201);

                    // sailor removes data in order to resolve conflict
                    const hooksDataDeleteNock = nock(env.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                        .reply(400);

                    // response for a subscription request, which performed inside of init method
                    nock('https://api.acme.com')
                        .post('/subscribe')
                        .reply(200, {
                            id: 'subscription_12345'
                        })
                        .get('/customers')
                        .reply(200, customers);

                    amqpHelper.on('data', ({ properties, body }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        expect(startupRegistrationRequest).to.deep.equal({
                            data: 'startup'
                        });

                        expect(startupRegistrationNock.isDone()).to.be.ok;
                        expect(hooksDataNock.isDone()).to.be.ok;
                        expect(hooksDataDeleteNock.isDone()).to.not.be.ok;

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: env.ELASTICIO_EXEC_ID,
                            taskId: env.ELASTICIO_FLOW_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION,
                            messageId
                        });

                        expect(body).to.deep.equal({
                            originalMsg: inputMessage,
                            customers: customers,
                            subscription: {
                                id: 'subscription_12345',
                                cfg: {
                                    apiKey: 'secret'
                                }
                            }
                        });
                    }, done);

                    run = requireRun();

                    amqpHelper.publishMessage(inputMessage);
                });
            });

            describe('when startup method does not exist', () => {
                it('should store an empty hooks data and run trigger successfully', (done) => {
                    env.ELASTICIO_FUNCTION = 'trigger_with_no_hooks';

                    helpers.mockApiTaskStepResponse();

                    // sailor persists startup data via sailor-support API
                    const hooksDataNock = nock(env.ELASTICIO_API_URI)
                        .matchHeader('Connection', 'Keep-Alive')
                        .post('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data', {})
                        .reply(201);

                    // response for a subscription request, which performed inside of init method
                    nock('https://api.acme.com')
                        .get('/customers')
                        .reply(200, customers);

                    amqpHelper.on('data', ({ properties, body }, queueName) => {
                        expect(queueName).to.eql(amqpHelper.nextStepQueue);

                        delete properties.headers.start;
                        delete properties.headers.end;
                        delete properties.headers.cid;

                        expect(properties.headers).to.eql({
                            execId: env.ELASTICIO_EXEC_ID,
                            taskId: env.ELASTICIO_FLOW_ID,
                            workspaceId: env.ELASTICIO_WORKSPACE_ID,
                            containerId: env.ELASTICIO_CONTAINER_ID,
                            userId: env.ELASTICIO_USER_ID,
                            stepId: env.ELASTICIO_STEP_ID,
                            compId: env.ELASTICIO_COMP_ID,
                            function: env.ELASTICIO_FUNCTION,
                            messageId
                        });

                        expect(body).to.deep.equal({
                            originalMsg: inputMessage,
                            customers: customers
                        });

                        expect(hooksDataNock.isDone()).to.be.ok;
                    }, done);

                    run = requireRun();

                    amqpHelper.publishMessage(inputMessage);
                });
            });
        });

        describe('when env ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS is set', () => {

            beforeEach(() => {
                env.ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS = 'ELASTICIO_FIRST, ELASTICIO_SECOND_ELASTICIO_ENV ,'
                    + 'ELASTICIO_NOT_PRESENT';

                env.ELASTICIO_RANDOM = 'random';
                env.ELASTICIO_FIRST = 'first';
                env.ELASTICIO_SECOND_ELASTICIO_ENV = 'second';
            });

            afterEach(() => {
                delete env.ELASTICIO_ADDITIONAL_VARS_FOR_HEADERS;
                delete env.ELASTICIO_RANDOM;
                delete env.FIRST;
                delete env.ELASTICIO_SECOND_ELASTICIO_ENV;
            });

            it('should run trigger successfully and pass additional vars to headers', (done) => {


                helpers.mockApiTaskStepResponse();

                nock('https://api.acme.com')
                    .post('/subscribe')
                    .reply(200, {
                        id: 'subscription_12345'
                    })
                    .get('/customers')
                    .reply(200, customers);

                amqpHelper.on('data', ({ properties, body }, queueName) => {
                    expect(queueName).to.eql(amqpHelper.nextStepQueue);

                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;

                    expect(properties.headers).to.deep.equal({
                        first: 'first',
                        secondElasticioEnv: 'second',
                        execId: env.ELASTICIO_EXEC_ID,
                        taskId: env.ELASTICIO_FLOW_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        threadId,
                        parentMessageId: parentMessageId,
                        messageId
                    });

                    expect(body).to.deep.equal({
                        originalMsg: inputMessage,
                        customers: customers,
                        subscription: {
                            id: 'subscription_12345',
                            cfg: {
                                apiKey: 'secret'
                            }
                        }
                    });
                }, done);

                run = requireRun();

                amqpHelper.publishMessage(inputMessage, {
                    parentMessageId,
                    threadId
                });
            });

        });

        describe('when reply_to header is set', () => {
            it('should send http reply successfully', (done) => {

                env.ELASTICIO_FUNCTION = 'http_reply_action';

                helpers.mockApiTaskStepResponse();

                nock('https://api.acme.com')
                    .post('/subscribe')
                    .reply(200, {
                        id: 'subscription_12345'
                    })
                    .get('/customers')
                    .reply(200, customers);

                amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {
                    expect(queueName).to.eql(amqpHelper.httpReplyQueueName);

                    delete properties.headers.start;
                    delete properties.headers.end;
                    delete properties.headers.cid;

                    expect(properties.headers.messageId).to.be.a('string');
                    delete properties.headers.messageId;

                    expect(properties.headers).to.eql({
                        execId: env.ELASTICIO_EXEC_ID,
                        taskId: env.ELASTICIO_FLOW_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION,
                        reply_to: amqpHelper.httpReplyQueueRoutingKey
                    });

                    expect(emittedMessage).to.eql({
                        headers: {
                            'content-type': 'text/plain'
                        },
                        body: 'Ok',
                        statusCode: 200
                    });
                }, done);

                run = requireRun();

                amqpHelper.publishMessage(inputMessage, {}, {
                    reply_to: amqpHelper.httpReplyQueueRoutingKey
                });
            });
        });

        describe('when sailor could not init the module', () => {
            it('should publish init errors to RabbitMQ', (done) => {
                const logCriticalErrorStub = sinon.stub(logging, 'criticalErrorAndExit');

                env.ELASTICIO_FUNCTION = 'fails_to_init';

                helpers.mockApiTaskStepResponse();

                amqpHelper.on('data', ({ properties, emittedMessage }, queueName) => {
                    expect(queueName).to.eql(amqpHelper.nextStepErrorQueue);

                    expect(JSON.parse(emittedMessage.error).message).to.equal('OMG. I cannot init');

                    expect(properties.headers).to.eql({
                        execId: env.ELASTICIO_EXEC_ID,
                        taskId: env.ELASTICIO_FLOW_ID,
                        workspaceId: env.ELASTICIO_WORKSPACE_ID,
                        containerId: env.ELASTICIO_CONTAINER_ID,
                        userId: env.ELASTICIO_USER_ID,
                        stepId: env.ELASTICIO_STEP_ID,
                        compId: env.ELASTICIO_COMP_ID,
                        function: env.ELASTICIO_FUNCTION
                    });
                }, done);

                run = requireRun();
            });
        });
    });

    describe('when sailor is being invoked for shutdown', () => {
        describe('when hooksdata is found', () => {
            it('should execute shutdown hook successfully', (done) => {

                env.ELASTICIO_HOOK_SHUTDOWN = '1';

                const subsriptionResponse = {
                    subId: '507'
                };

                let requestFromShutdownHook;
                const requestFromShutdownNock = nock('http://example.com/')
                    .post('/subscriptions/disable')
                    .reply(200, (uri, requestBody) => {
                        requestFromShutdownHook = requestBody;
                        return {
                            status: 'ok'
                        };
                    });

                // sailor retrieves startup data via sailor-support API
                const hooksDataGetNock = nock(env.ELASTICIO_API_URI)
                    .matchHeader('Connection', 'Keep-Alive')
                    .get('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                    .reply(200, subsriptionResponse);

                // sailor removes startup data via sailor-support API
                const hooksDataDeleteNock = nock(env.ELASTICIO_API_URI)
                    .matchHeader('Connection', 'Keep-Alive')
                    .delete('/sailor-support/hooks/task/5559edd38968ec0736000003/startup/data')
                    .reply(204);

                helpers.mockApiTaskStepResponse();

                hooksDataDeleteNock.on('replied', () => setTimeout(checkResult, 50));

                function checkResult() {
                    expect(hooksDataGetNock.isDone()).to.be.ok;

                    expect(requestFromShutdownHook).to.deep.equal({
                        cfg: {
                            apiKey: 'secret'
                        },
                        startupData: subsriptionResponse
                    });

                    expect(requestFromShutdownNock.isDone()).to.be.ok;
                    expect(hooksDataDeleteNock.isDone()).to.be.ok;

                    done();
                }

                run = requireRun();
            });
        });

        describe('when request for hooksdata is failed with an error', () => {
            // @todo
            it('should not execute shutdown hook');
        });

        describe('when shutdown hook method is not found', () => {
            // @todo
            it('should not thrown error and just finish process');
        });
    });
});

function requireRun() {
    //@todo it would be great to use something like this https://github.com/jveski/shelltest
    const path = '../run.js';
    const resolved = require.resolve(path);
    delete require.cache[resolved];
    return require(path);
}
