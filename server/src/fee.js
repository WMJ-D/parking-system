// 计费规则：免费时长只扣一次；超过后按小时向上取整，每日封顶按"每24小时"分段
function calcFee(hours, rule) {
  const freeH = Number(rule.free_minutes) / 60;
  const price = Number(rule.price_per_hour);
  const cap = Number(rule.daily_cap);
  const remaining = hours - freeH;
  if (remaining <= 0) return 0;
  const fullDays = Math.floor(remaining / 24);
  const remainder = remaining - fullDays * 24;
  return fullDays * cap + Math.min(Math.ceil(remainder) * price, cap);
}

// 综合计费：处理月卡跨期 —— 卡覆盖时段免费，过期后时段正常计费
function computeParkingFee(rec, veh, rule, now = Date.now()) {
  const entry = new Date(rec.entry_time).getTime();
  const hours = (now - entry) / 3600000;
  let fee = calcFee(hours, rule);
  let free = false;          // 全程免费（月卡覆盖至今）
  let cardCoveredUntil = null; // 部分覆盖：卡覆盖到该时刻，之后计费
  const card = veh && veh.monthly_card === 1 && veh.card_expire
    ? new Date(veh.card_expire + ' 23:59:59').getTime() : null;
  if (card !== null) {
    if (card >= now) {
      fee = 0; free = true;
    } else if (card > entry) {
      fee = calcFee((now - card) / 3600000, rule);
      cardCoveredUntil = veh.card_expire + ' 23:59:59';
    }
    // 卡在入场前就已过期：全程计费（默认逻辑）
  }
  return { fee, free, hours, cardCoveredUntil };
}

module.exports = { calcFee, computeParkingFee };