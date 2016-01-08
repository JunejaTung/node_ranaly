var moment = require('moment');

var ZMINSCORE = ' \
local result = {} \
local length = #ARGV \
  for i = 2, length-1 do \
    if i == 2 then \
      local sctmp = redis.call("zscore", KEYS[1],ARGV[2]) \
      if not sctmp then \
        sctmp = 0 \
      else \
        sctmp = tonumber(sctmp) \
      end \
      result[1] = sctmp \
    end  \
    local score = 0 \
    for j =1 ,ARGV[1] do \
      local sctmp = redis.call("zscore", KEYS[1],ARGV[i]+j) \
      if not sctmp then \
        sctmp = 0 \
      else \
        sctmp = tonumber(sctmp) \
      end \
      score = score + sctmp \
    end \
    result[i] = score \
  end \
  return result \
';

var ZMSCORE = ' \
local result = {} \
local length = #ARGV \
for i = 1, length do \
  local score = 0 \
  if #ARGV[i] == 8 then \
    for j = 0, 23 do \
      local k = tostring(j) \
      if #k == 1 then \
        k = "0" .. k \
      end \
      local r = redis.call("zscore", KEYS[1], ARGV[i] .. k) \
      if r then \
        score = score + r \
      end \
    end \
  else \
    score = redis.call("zscore", KEYS[1], ARGV[i]) \
    if not score then \
      score = 0 \
    else \
      score = tonumber(score) \
    end \
  end \
  result[i] = score \
end \
return result \
';

var ZSUMSCORE = ' \
local length = #ARGV \
local score = 0 \
if #ARGV >= 1 then \
  for i = 1, length do \
    if #ARGV[i] == 8 then \
      for j = 0, 23 do \
        local k = tostring(j) \
        if #k == 1 then \
          k = "0" .. k \
        end \
        local result = redis.call("zscore", KEYS[1], ARGV[i] .. k) \
        if result then \
          score = score + result \
        end \
      end \
    else \
      local result = redis.call("zscore", KEYS[1], ARGV[i]) \
      if result then \
        score = score + result \
      end \
    end \
  end \
else \
  local result = redis.call("get", KEYS[1] .. ":TOTAL") \
  if result then \
    score = tonumber(result) \
  end \
end \
return score \
';
module.exports = function (ranaly) {
  var db = ranaly.redisClient;

  var Amount = function (bucket) {
    this.bucket = bucket;
    this.key = ranaly.prefix + 'AMOUNT' + ':' + this.bucket;
    this.mkey = ranaly.prefix + 'MINUTE' + ':' + this.bucket;
  };

  Amount.prototype.incr = function (increment, when, callback) {
    if (typeof increment === 'function') {
      callback = increment;
      increment = void 0;
    } else if (typeof when === 'function') {
      callback = when;
      when = void 0;
    }
    if (typeof increment !== 'number') {
      increment = 1;
    }
    when = moment(when);
    db.multi()
      .incrby(this.key + ':TOTAL', increment)
      .zincrby(this.key, increment,when.format('YYYYMMDDHH'))
      .zincrby(this.mkey, increment,when.format('YYYYMMDDHHmm'))
      .exec(function (err, result) {
        if (typeof callback === 'function') {
          callback(err, Array.isArray(result) ? result[0] : result);
        }
      });
  };

  Amount.prototype.decr = function (decrement, when, callback) {
    if (typeof decrement === 'function') {
      callback = decrement;
      decrement = void 0;
    } else if (typeof when === 'function') {
      callback = when;
      when = void 0;
    }
    if (typeof decrement !== 'number') {
      decrement = 1;
    }
    when = moment(when);
    db.multi()
      .decrby(this.key + ':TOTAL', decrement)
      .zincrby(this.key, -decrement, when.format('YYYYMMDDHH'))
      .zincrby(this.mkey, -decrement, when.format('YYYYMMDDHHmm'))
      .exec(function (err, result) {
        if (typeof callback === 'function') {
          callback(err, Array.isArray(result) ? result[0] : result);
        }
      });
  };

  Amount.prototype.get = function (timeList, callback) {
    var next = function (err, result) {
      callback(err, result);
    };

    if (timeList[1].length == 12 ) {
      var num = timeList[1].substring(10)-timeList[0].substring(10);
      num = (num < 0) ? num+60 : num;
      db['eval'].apply(db, [ZMINSCORE].concat(1).concat(this.mkey).concat(num).concat(timeList).concat(next));
    }else{
      db['eval'].apply(db, [ZMSCORE].concat(1).concat(this.key).concat(timeList).concat(next));
    }
  };

  Amount.prototype.sum = function (timeList, callback) {
    var next = function (err, result) {
      callback(err, result);
    };
    var tl = [ZSUMSCORE].concat(1).concat(this.key);
    if (Array.isArray(timeList) && timeList.length > 0) {
      tl = tl.concat(timeList).concat(next);
    } else {
      tl = tl.concat(next);
    }
    db['eval'].apply(db, tl);
  };

  Amount.prototype.set = function (total, callback) {
    var chgNum = 0;
    var _this  = this;

    db.get(this.key + ':TOTAL', function (err, resSum) {
      if (resSum !== null) {
        chgNum = total - resSum;

        Amount.prototype.incr.call(_this, chgNum, callback);
      } else {
        Amount.prototype.incr.call(_this, total, callback);
      }
    });
  };

  // ��ʱ���������ֵ
  Amount.prototype.setGross = function (value, when, callback) {
    if (typeof when === 'function') {
      callback = when;
      when = void 0;
    }
    when = moment(when);
    db.multi()
      .zadd(this.key + ':GROSS', value, when.format('YYYYMMDDHH'))
      .zadd(this.mkey + ':GROSS', value, when.format('YYYYMMDDHHmm'))
      .exec(function (err, result) {
        if (typeof callback === 'function') {
          callback(err, Array.isArray(result) ? result[0] : result);
        }
      });
  };

  Amount.prototype.getGross = function (timeList, callback) {
    var next = function (err, result) {
      callback(err, result);
    };
    var slen = timeList[1].length;

    switch (slen) {
      case 12: {
        var num = timeList[1].substring(10)-timeList[0].substring(10);

        num = (num < 0) ? num+60 : num;
        db['eval'].apply(db, [ZMINSCORE].concat(1).concat(this.mkey + ':GROSS').concat(num).concat(timeList).concat(next));
        break;
      }
      case 10: {
        db['eval'].apply(db, [ZMSCORE].concat(1).concat(this.key + ':GROSS').concat(timeList).concat(next));
        break;
      }
      case 8: {
        var tmpList = [];
        var tlen    = timeList.length;
        var i = 0;

        for (; i < tlen-1; i++) {
          tmpList.push(timeList[i] + '23');
        }
        tmpList.push(timeList[i] + moment().format('HH'));
        db['eval'].apply(db, [ZMSCORE].concat(1).concat(this.key + ':GROSS').concat(tmpList).concat(next));
        break;
      }
      default : {
        console.error('[RANALY]Invalid timestamps: ' + timeList[0]);
      }
    }
  };

  return Amount;
};

