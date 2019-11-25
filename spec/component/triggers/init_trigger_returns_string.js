exports.init = initTrigger;
exports.process = processTrigger;

function initTrigger(cfg) {
  return 'this_is_a_string';
}

function processTrigger(msg, cfg) {
  const that = this;
  that.emit('data', {
    body: {},
  });
  that.emit('end');
}
