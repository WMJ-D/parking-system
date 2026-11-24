// AI 工具集：把系统接口能力封装为模型可调用的函数
// 读工具直接查询数据库；写工具复用业务规则并记录操作日志
const pool = require('../db');
const { log } = require('../auth');
const { computeParkingFee } = require('../fee');

const TOOL_TITLES = {
  get_dashboard: '经营看板',
  query_spots: '车位查询',
  query_zones: '分区查询',
  query_vehicles: '车辆查询',
  query_records: '进出记录查询',
  query_debts: '欠费查询',
  query_income_report: '收入报表',
  get_fee_rules: '收费规则',
  query_payments: '月卡缴费记录',
  query_logs: '操作日志',
  query_users: '系统用户',
  add_vehicle: '登记车辆',
  vehicle_entry: '车辆入场',
  vehicle_exit: '车辆出场',
  renew_monthly_card: '月卡续费',
  settle_debt: '结清欠费',
  add_spot: '新增车位',
  add_zone: '新增分区',
  update_fee_rules: '修改收费规则',
  navigate_page: '页面跳转',
  export_income_report: '导出收入报表',
  export_records: '导出进出记录',
  export_logs: '导出操作日志'
};

const spotStatusText = { free: '空闲', occupied: '占用', disabled: '停用' };
const spotTypeText = { fixed: '固定', temporary: '临时' };
const recordStatusText = { in: '在场', out: '已出场' };
const payStatusText = { unpaid: '未缴', paid: '已缴', free: '免费' };
const vtypeText = { resident: '住户', temp: '临时' };

const ok = (summary, data) => ({ ok: true, summary, data });
const fail = (msg, data) => ({ ok: false, summary: msg, error: msg, data });
const num = v => Number(v || 0);
const money = v => Math.round(num(v) * 100) / 100;
const dt = s => (s ? String(s).slice(0, 16) : '');

function limitOf(v, def = 20, max = 50) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

function localMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ============================ 工具定义 ============================ */
const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'get_dashboard',
      description: '获取停车场经营看板汇总：车位总数/空闲/占用/停用、今日入场与出场车次、今日收入、本月收入、车辆总数、月卡数量、30天内到期的月卡、在场超过24小时的车辆。回答"今天经营情况如何"这类问题优先用它。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_spots',
      description: '查询车位列表，可按状态、分区、车位号或绑定车牌筛选，并返回符合条件的总数。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['free', 'occupied', 'disabled'], description: 'free=空闲，occupied=有车占用，disabled=停用' },
          zone: { type: 'string', description: '分区名称，支持模糊匹配，如"东区"' },
          keyword: { type: 'string', description: '车位号或绑定车牌的关键词' },
          limit: { type: 'integer', description: '返回条数上限，默认20，最大50' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_zones',
      description: '查询所有停车分区，以及每个分区的车位总数和空闲数。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_vehicles',
      description: '查询车辆档案，可按车牌/车主/电话/房号关键词、车辆类型、是否月卡、是否黑名单筛选。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '车牌号/车主姓名/电话/房号关键词' },
          vtype: { type: 'string', enum: ['resident', 'temp'], description: 'resident=住户车辆，temp=临时车辆' },
          monthly_card: { type: 'boolean', description: 'true=只看有月卡的车辆，false=只看无月卡的车辆' },
          blacklist: { type: 'boolean', description: 'true=只看黑名单车辆' },
          limit: { type: 'integer', description: '返回条数上限，默认20，最大50' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_records',
      description: '查询车辆进出记录，可按在场状态、车牌号、入场日期范围筛选。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['in', 'out'], description: 'in=当前在场，out=已出场' },
          plate_no: { type: 'string', description: '车牌号，支持模糊匹配' },
          start: { type: 'string', description: '入场日期起，格式 YYYY-MM-DD' },
          end: { type: 'string', description: '入场日期止，格式 YYYY-MM-DD' },
          limit: { type: 'integer', description: '返回条数上限，默认20，最大50' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_debts',
      description: '查询欠费。不传车牌号时返回全部欠费车牌汇总；传车牌号时返回该车的欠费明细。',
      parameters: {
        type: 'object',
        properties: {
          plate_no: { type: 'string', description: '车牌号，可选；传则查询该车欠费明细' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_income_report',
      description: '查询指定月份的收入报表，含每日出场车次与收入、整月合计。',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '月份，格式 YYYY-MM，不传默认当月' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_fee_rules',
      description: '查询当前收费规则：免费时长（分钟）、每小时单价、每日封顶、月卡价格。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_payments',
      description: '查询最近的月卡缴费记录（车牌、车主、续费月数、金额、起止日期）。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '返回条数上限，默认10，最大50' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_logs',
      description: '查询最近的系统操作日志。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '返回条数上限，默认15，最大50' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_users',
      description: '查询系统用户列表（仅管理员可用）。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '返回条数上限，默认20，最大50' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_vehicle',
      description: '登记一辆新车辆档案。写操作，会直接写入数据库。车牌号和车主姓名必填。',
      parameters: {
        type: 'object',
        properties: {
          plate_no: { type: 'string', description: '车牌号，如 京A12345' },
          owner_name: { type: 'string', description: '车主姓名' },
          phone: { type: 'string', description: '联系电话' },
          house_no: { type: 'string', description: '房号' },
          vtype: { type: 'string', enum: ['resident', 'temp'], description: 'resident=住户车辆（默认），temp=临时车辆' },
          monthly_card: { type: 'boolean', description: '是否同时办理月卡' },
          card_expire: { type: 'string', description: '月卡到期日，格式 YYYY-MM-DD，办理月卡时填写' }
        },
        required: ['plate_no', 'owner_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vehicle_entry',
      description: '办理车辆入场：自动分配车位（固定车位优先），返回分配的车位号和历史欠费。写操作。',
      parameters: {
        type: 'object',
        properties: {
          plate_no: { type: 'string', description: '车牌号' }
        },
        required: ['plate_no']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'vehicle_exit',
      description: '办理车辆出场：自动计费（月卡有效免费，免费时长/按小时计费/每日封顶），释放车位。写操作。',
      parameters: {
        type: 'object',
        properties: {
          plate_no: { type: 'string', description: '车牌号' },
          unpaid: { type: 'boolean', description: '是否挂账未缴放行，默认 false（正常收费）' },
          actual_fee: { type: 'number', description: '实收金额，不传默认按应收金额收取' }
        },
        required: ['plate_no']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'renew_monthly_card',
      description: '为车辆办理月卡续费，未到期会从到期日次日顺延，并生成缴费记录。写操作。',
      parameters: {
        type: 'object',
        properties: {
          plate_no: { type: 'string', description: '车牌号' },
          months: { type: 'integer', description: '续费月数，1~24' }
        },
        required: ['plate_no', 'months']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'settle_debt',
      description: '结清某车牌的全部未缴欠费。写操作。',
      parameters: {
        type: 'object',
        properties: {
          plate_no: { type: 'string', description: '车牌号' }
        },
        required: ['plate_no']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_spot',
      description: '新增一个车位，需要指定车位号和所属分区。写操作。',
      parameters: {
        type: 'object',
        properties: {
          spot_no: { type: 'string', description: '车位号，如 A-001' },
          zone: { type: 'string', description: '分区名称（如"东区"）或分区ID；不确定时先调用 query_zones' },
          stype: { type: 'string', enum: ['fixed', 'temporary'], description: 'fixed=固定车位，temporary=临时车位（默认）' }
        },
        required: ['spot_no', 'zone']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_zone',
      description: '新增一个停车分区。写操作。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '分区名称' },
          remark: { type: 'string', description: '备注' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_fee_rules',
      description: '修改收费规则，只需传要修改的字段（免费时长、每小时单价、每日封顶、月卡价格、规则名称）。写操作。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '规则名称' },
          free_minutes: { type: 'integer', description: '免费时长（分钟）' },
          price_per_hour: { type: 'number', description: '每小时单价（元）' },
          daily_cap: { type: 'number', description: '每日封顶（元）' },
          monthly_price: { type: 'number', description: '月卡价格（元/月）' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate_page',
      description: '打开系统的功能页面。用户说"打开/去/看看 xx 页面"时调用。',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['dashboard', 'spots', 'vehicles', 'records', 'payments', 'debts', 'reports', 'rules', 'users', 'logs'],
            description: '页面标识：dashboard=数据看板，spots=车位管理，vehicles=车辆管理，records=进出管理，payments=月卡缴费，debts=欠费管理，reports=报表中心，rules=收费规则，users=系统用户（仅管理员），logs=操作日志'
          },
          vehicle_id: { type: 'integer', description: '可选，跳转月卡缴费页时预选车辆ID' }
        },
        required: ['page']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_income_report',
      description: '导出指定月份的收入报表 Excel 文件并触发浏览器下载。用户说"导出收入报表""下载收入报表"时调用。',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '月份，格式 YYYY-MM，不传默认当月' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_records',
      description: '导出指定日期范围的车辆进出记录 Excel 文件并触发浏览器下载。用户说"导出进出记录""下载进出记录"时调用。',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: '开始日期，格式 YYYY-MM-DD，不传默认当月1日' },
          end: { type: 'string', description: '结束日期，格式 YYYY-MM-DD，不传默认当月最后一天' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_logs',
      description: '导出系统操作日志 Excel 文件并触发浏览器下载。用户说"导出操作日志""下载日志"时调用。',
      parameters: { type: 'object', properties: {} }
    }
  }
];

/* ============================ 查询工具 ============================ */
async function getDashboard() {
  const [spotStat] = await pool.query(
    "SELECT COUNT(*) total, SUM(status='occupied') occupied, SUM(status='free') free, SUM(status='disabled') disabled FROM spots");
  const [todayIn] = await pool.query('SELECT COUNT(*) c FROM records WHERE DATE(entry_time)=CURDATE()');
  const [todayOut] = await pool.query('SELECT COUNT(*) c FROM records WHERE DATE(exit_time)=CURDATE()');
  const [todayIncome] = await pool.query(
    "SELECT IFNULL(SUM(actual_fee),0) s FROM records WHERE status='out' AND DATE(exit_time)=CURDATE()");
  const [monthIncome] = await pool.query(
    "SELECT IFNULL(SUM(actual_fee),0) s FROM records WHERE status='out' AND DATE_FORMAT(exit_time,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')");
  const [vehicleCnt] = await pool.query('SELECT COUNT(*) c FROM vehicles');
  const [monthlyCnt] = await pool.query('SELECT COUNT(*) c FROM vehicles WHERE monthly_card=1');
  const [expireSoon] = await pool.query(
    `SELECT plate_no, owner_name, card_expire FROM vehicles
     WHERE monthly_card=1 AND card_expire IS NOT NULL AND card_expire <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
     ORDER BY card_expire LIMIT 20`);
  const [longStay] = await pool.query(
    `SELECT r.plate_no, s.spot_no, r.entry_time, TIMESTAMPDIFF(HOUR, r.entry_time, NOW()) h
     FROM records r LEFT JOIN spots s ON s.id=r.spot_id
     WHERE r.status='in' AND r.entry_time < NOW() - INTERVAL 24 HOUR
     ORDER BY r.entry_time LIMIT 20`);
  const s = spotStat[0];
  const total = num(s.total);
  return ok('已获取经营看板数据', {
    spots: {
      total,
      free: num(s.free),
      occupied: num(s.occupied),
      disabled: num(s.disabled),
      usage_rate: total ? Math.round(num(s.occupied) / total * 100) : 0
    },
    today: { entry_count: num(todayIn[0].c), exit_count: num(todayOut[0].c), income: money(todayIncome[0].s) },
    month_income: money(monthIncome[0].s),
    vehicles: num(vehicleCnt[0].c),
    monthly_cards: num(monthlyCnt[0].c),
    expire_soon: expireSoon,
    long_stay: longStay.map(r => ({ plate_no: r.plate_no, spot_no: r.spot_no || '', entry_time: dt(r.entry_time), hours: r.h }))
  });
}

async function querySpots(args) {
  const conds = [];
  const params = [];
  if (args.status) { conds.push('s.status=?'); params.push(String(args.status)); }
  if (args.zone) { conds.push('z.name LIKE ?'); params.push(`%${args.zone}%`); }
  if (args.keyword) { conds.push('(s.spot_no LIKE ? OR v.plate_no LIKE ?)'); params.push(`%${args.keyword}%`, `%${args.keyword}%`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const from = 'FROM spots s JOIN zones z ON z.id=s.zone_id LEFT JOIN vehicles v ON v.id=s.vehicle_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${from} ${where}`, params);
  const [rows] = await pool.query(
    `SELECT s.spot_no, z.name zone_name, s.stype, s.status, v.plate_no, v.owner_name
     ${from} ${where} ORDER BY z.id, s.spot_no LIMIT ?`, [...params, limitOf(args.limit)]);
  const list = rows.map(r => ({
    spot_no: r.spot_no,
    zone: r.zone_name,
    type: spotTypeText[r.stype] || r.stype,
    status: spotStatusText[r.status] || r.status,
    plate_no: r.plate_no || '',
    owner_name: r.owner_name || ''
  }));
  return ok(`共 ${num(total)} 个车位，返回 ${list.length} 条`, { total: num(total), list });
}

async function queryZones() {
  const [rows] = await pool.query(
    `SELECT z.id, z.name, z.remark, COUNT(s.id) spot_count, SUM(s.status='free') free_count
     FROM zones z LEFT JOIN spots s ON s.zone_id=z.id GROUP BY z.id ORDER BY z.id`);
  return ok(`共 ${rows.length} 个分区`, {
    list: rows.map(r => ({ id: r.id, name: r.name, remark: r.remark || '', spot_count: num(r.spot_count), free_count: num(r.free_count) }))
  });
}

async function queryVehicles(args) {
  const conds = [];
  const params = [];
  if (args.keyword) {
    conds.push('(plate_no LIKE ? OR owner_name LIKE ? OR phone LIKE ? OR house_no LIKE ?)');
    params.push(`%${args.keyword}%`, `%${args.keyword}%`, `%${args.keyword}%`, `%${args.keyword}%`);
  }
  if (args.vtype) { conds.push('vtype=?'); params.push(String(args.vtype)); }
  if (args.monthly_card !== undefined) { conds.push('monthly_card=?'); params.push(args.monthly_card ? 1 : 0); }
  if (args.blacklist !== undefined) { conds.push('blacklist=?'); params.push(args.blacklist ? 1 : 0); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM vehicles ${where}`, params);
  const [rows] = await pool.query(`SELECT * FROM vehicles ${where} ORDER BY id DESC LIMIT ?`, [...params, limitOf(args.limit)]);
  return ok(`共 ${num(total)} 辆车，返回 ${rows.length} 条`, {
    total: num(total),
    list: rows.map(v => ({
      id: v.id,
      plate_no: v.plate_no,
      owner_name: v.owner_name,
      phone: v.phone || '',
      house_no: v.house_no || '',
      vtype: vtypeText[v.vtype] || v.vtype,
      monthly_card: v.monthly_card ? '有' : '无',
      card_expire: v.card_expire || '',
      blacklist: v.blacklist ? '是' : '否',
      blacklist_reason: v.blacklist_reason || ''
    }))
  });
}

async function queryRecords(args) {
  const conds = [];
  const params = [];
  if (args.status) { conds.push('r.status=?'); params.push(String(args.status)); }
  if (args.plate_no) { conds.push('r.plate_no LIKE ?'); params.push(`%${args.plate_no}%`); }
  if (args.start) { conds.push('r.entry_time >= ?'); params.push(args.start); }
  if (args.end) { conds.push('r.entry_time <= ?'); params.push(`${args.end} 23:59:59`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM records r ${where}`, params);
  const [rows] = await pool.query(
    `SELECT r.id, r.plate_no, s.spot_no, r.entry_time, r.exit_time, r.fee, r.actual_fee, r.status, r.pay_status, r.operator
     FROM records r LEFT JOIN spots s ON s.id=r.spot_id ${where} ORDER BY r.id DESC LIMIT ?`,
    [...params, limitOf(args.limit)]);
  return ok(`共 ${num(total)} 条记录，返回 ${rows.length} 条`, {
    total: num(total),
    list: rows.map(r => ({
      id: r.id,
      plate_no: r.plate_no,
      spot_no: r.spot_no || '',
      entry_time: dt(r.entry_time),
      exit_time: r.exit_time ? dt(r.exit_time) : '',
      fee: money(r.fee),
      actual_fee: r.actual_fee === null ? null : money(r.actual_fee),
      status: recordStatusText[r.status] || r.status,
      pay_status: payStatusText[r.pay_status] || r.pay_status,
      hours_in: r.status === 'in'
        ? Math.round((Date.now() - new Date(r.entry_time).getTime()) / 3600000 * 10) / 10
        : null
    }))
  });
}

async function queryDebts(args) {
  const plate = String(args.plate_no || '').trim();
  if (plate) {
    const [rows] = await pool.query(
      `SELECT r.plate_no, s.spot_no, r.entry_time, r.exit_time, r.fee
       FROM records r LEFT JOIN spots s ON s.id=r.spot_id
       WHERE r.plate_no=? AND r.status='out' AND r.pay_status='unpaid' AND r.fee>0
       ORDER BY r.exit_time DESC LIMIT 50`, [plate]);
    const total = money(rows.reduce((a, r) => a + num(r.fee), 0));
    return ok(`${plate} 共 ${rows.length} 笔欠费，合计 ${total.toFixed(2)} 元`, {
      plate_no: plate,
      count: rows.length,
      total,
      list: rows.map(r => ({
        spot_no: r.spot_no || '',
        entry_time: dt(r.entry_time),
        exit_time: dt(r.exit_time),
        fee: money(r.fee)
      }))
    });
  }
  const [rows] = await pool.query(
    `SELECT plate_no, COUNT(*) cnt, SUM(fee) total, MAX(exit_time) last_time
     FROM records WHERE status='out' AND pay_status='unpaid' AND fee>0
     GROUP BY plate_no ORDER BY total DESC LIMIT ?`, [limitOf(args.limit)]);
  const sum = money(rows.reduce((a, r) => a + num(r.total), 0));
  return ok(`共有 ${rows.length} 个车牌欠费，合计 ${sum.toFixed(2)} 元`, {
    count: rows.length,
    total: sum,
    list: rows.map(r => ({ plate_no: r.plate_no, count: num(r.cnt), total: money(r.total), last_exit: dt(r.last_time) }))
  });
}

async function queryIncomeReport(args) {
  const month = /^\d{4}-\d{2}$/.test(String(args.month || '')) ? args.month : localMonth();
  const [daily] = await pool.query(
    `SELECT DATE(exit_time) d, COUNT(*) cnt, IFNULL(SUM(actual_fee),0) income
     FROM records WHERE status='out' AND DATE_FORMAT(exit_time,'%Y-%m')=?
     GROUP BY DATE(exit_time) ORDER BY d`, [month]);
  const [sum] = await pool.query(
    `SELECT COUNT(*) cnt, IFNULL(SUM(actual_fee),0) income
     FROM records WHERE status='out' AND DATE_FORMAT(exit_time,'%Y-%m')=?`, [month]);
  return ok(`${month} 收入合计 ${money(sum[0].income).toFixed(2)} 元`, {
    month,
    total: { count: num(sum[0].cnt), income: money(sum[0].income) },
    daily: daily.map(r => ({ date: String(r.d).slice(0, 10), count: num(r.cnt), income: money(r.income) }))
  });
}

async function getFeeRules() {
  const [rows] = await pool.query('SELECT * FROM fee_rules ORDER BY id');
  return ok(`共 ${rows.length} 条收费规则`, {
    list: rows.map(r => ({
      id: r.id,
      name: r.name,
      free_minutes: num(r.free_minutes),
      price_per_hour: money(r.price_per_hour),
      daily_cap: money(r.daily_cap),
      monthly_price: money(r.monthly_price)
    }))
  });
}

async function queryPayments(args) {
  const [rows] = await pool.query(
    `SELECT p.id, v.plate_no, v.owner_name, p.months, p.amount, p.start_date, p.end_date, p.pay_time, p.operator
     FROM payments p JOIN vehicles v ON v.id=p.vehicle_id ORDER BY p.id DESC LIMIT ?`, [limitOf(args.limit, 10)]);
  return ok(`最近 ${rows.length} 笔月卡缴费记录`, {
    list: rows.map(r => ({
      plate_no: r.plate_no,
      owner_name: r.owner_name,
      months: num(r.months),
      amount: money(r.amount),
      start_date: r.start_date,
      end_date: r.end_date,
      pay_time: dt(r.pay_time),
      operator: r.operator || ''
    }))
  });
}

async function queryLogs(args) {
  const [rows] = await pool.query(
    'SELECT username, action, detail, created_at FROM logs ORDER BY id DESC LIMIT ?', [limitOf(args.limit, 15)]);
  return ok(`最近 ${rows.length} 条操作日志`, {
    list: rows.map(r => ({ username: r.username, action: r.action, detail: r.detail || '', time: dt(r.created_at) }))
  });
}

async function queryUsers(args, user) {
  if (user.role !== 'admin') return fail('仅管理员可以查询系统用户');
  const [rows] = await pool.query(
    'SELECT id, username, name, role, created_at FROM users ORDER BY id LIMIT ?', [limitOf(args.limit)]);
  return ok(`共 ${rows.length} 个系统用户`, {
    list: rows.map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role === 'admin' ? '管理员' : '操作员', created_at: dt(u.created_at) }))
  });
}

/* ============================ 写操作工具 ============================ */
async function addVehicle(args, user) {
  const plate = String(args.plate_no || '').trim();
  const owner = String(args.owner_name || '').trim();
  if (!plate || !owner) return fail('车牌号和车主姓名必填');
  const monthly = args.monthly_card ? 1 : 0;
  try {
    const [r] = await pool.query(
      'INSERT INTO vehicles (plate_no, owner_name, phone, house_no, vtype, monthly_card, card_expire) VALUES (?,?,?,?,?,?,?)',
      [plate, owner, String(args.phone || ''), String(args.house_no || ''),
        args.vtype === 'temp' ? 'temp' : 'resident', monthly, monthly ? (args.card_expire || null) : null]);
    await log(user.username, 'AI 登记车辆', plate);
    return ok(`已登记车辆 ${plate}（车主 ${owner}）`, { id: r.insertId, plate_no: plate, owner_name: owner, monthly_card: !!monthly, card_expire: monthly ? (args.card_expire || '') : '' });
  } catch (e) {
    return fail(e.code === 'ER_DUP_ENTRY' ? `车牌 ${plate} 已存在，请勿重复登记` : `登记失败：${e.message}`);
  }
}

async function vehicleEntry(args, user) {
  const plate = String(args.plate_no || '').trim();
  if (!plate) return fail('请输入车牌号');
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE plate_no=?', [plate]);
  if (!veh.length) return fail(`车辆 ${plate} 尚未登记，请先登记车辆档案`, { needRegister: true });
  if (veh[0].blacklist === 1) {
    await log(user.username, 'AI 黑名单拦截', `${plate} 拒绝入场`);
    return fail(`车辆 ${plate} 已被列入黑名单，禁止入场（原因：${veh[0].blacklist_reason || '未填写'}）`);
  }
  const [inRec] = await pool.query("SELECT id FROM records WHERE plate_no=? AND status='in'", [plate]);
  if (inRec.length) return fail(`车辆 ${plate} 已在场内，请勿重复入场`);
  const [[{ debt }]] = await pool.query(
    "SELECT IFNULL(SUM(fee),0) debt FROM records WHERE plate_no=? AND status='out' AND pay_status='unpaid'", [plate]);

  let spot = null;
  const [fixed] = await pool.query(
    "SELECT * FROM spots WHERE vehicle_id=(SELECT id FROM vehicles WHERE plate_no=?) AND status='free' LIMIT 1", [plate]);
  if (fixed.length) spot = fixed[0];
  if (!spot) {
    const pref = veh[0].vtype === 'temp' ? 'temporary' : 'fixed';
    const [same] = await pool.query("SELECT * FROM spots WHERE status='free' AND stype=? ORDER BY RAND() LIMIT 1", [pref]);
    spot = same[0] || null;
  }
  if (!spot) {
    const [any] = await pool.query("SELECT * FROM spots WHERE status='free' ORDER BY RAND() LIMIT 1");
    spot = any[0] || null;
  }
  if (!spot) return fail('当前无空闲车位，无法入场');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE spots SET status='occupied' WHERE id=?", [spot.id]);
    const [r] = await conn.query('INSERT INTO records (plate_no, spot_id, status, operator) VALUES (?,?,?,?)',
      [plate, spot.id, 'in', user.name]);
    await conn.commit();
    await log(user.username, 'AI 车辆入场', `${plate} -> ${spot.spot_no}`);
    return ok(`车辆 ${plate} 已入场，分配车位 ${spot.spot_no}`, {
      record_id: r.insertId, spot_no: spot.spot_no, unpaid_debt: money(debt)
    });
  } catch (e) {
    await conn.rollback();
    return fail(`入场失败：${e.message}`);
  } finally {
    conn.release();
  }
}

async function vehicleExit(args, user) {
  const plate = String(args.plate_no || '').trim();
  if (!plate) return fail('请输入车牌号');
  const [recs] = await pool.query(
    "SELECT * FROM records WHERE plate_no=? AND status='in' ORDER BY id DESC LIMIT 1", [plate]);
  if (!recs.length) return fail(`车辆 ${plate} 当前不在场内`);
  const rec = recs[0];
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE plate_no=?', [plate]);
  const [rules] = await pool.query('SELECT * FROM fee_rules ORDER BY id LIMIT 1');
  if (!rules.length) return fail('收费规则不存在，无法计费');
  const calc = computeParkingFee(rec, veh[0] || null, rules[0]);
  const fee = money(calc.fee);
  const unpaid = !!args.unpaid;
  const actual = unpaid ? 0 : (args.actual_fee !== undefined ? Number(args.actual_fee) : fee);
  if (!Number.isFinite(actual) || actual < 0) return fail('实收金额无效');
  const payStat = (unpaid && fee > 0) ? 'unpaid' : (actual > 0 ? 'paid' : 'free');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE records SET status='out', exit_time=NOW(), fee=?, actual_fee=?, pay_status=? WHERE id=?",
      [fee, actual, payStat, rec.id]);
    if (rec.spot_id) await conn.query("UPDATE spots SET status='free' WHERE id=? AND status='occupied'", [rec.spot_id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    return fail(`出场失败：${e.message}`);
  } finally {
    conn.release();
  }
  await log(user.username, 'AI 车辆出场', `${plate} 收费 ${actual} 元`);
  const minutes = Math.round(calc.hours * 60);

  const tail = unpaid && fee > 0 ? '已挂账记欠费' : `实收 ${actual.toFixed(2)} 元`;
  return ok(`车辆 ${plate} 已出场，停车约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分，应收 ${fee.toFixed(2)} 元，${tail}`, {
    fee,
    actual,
    free_by_monthly_card: calc.free,
    hours: Math.round(calc.hours * 10) / 10,
    pay_status: payStatusText[payStat] || payStat,
    card_covered_until: calc.cardCoveredUntil || ''
  });
}

async function renewMonthlyCard(args, user) {
  const plate = String(args.plate_no || '').trim();
  const months = Math.floor(Number(args.months));
  if (!plate) return fail('请输入车牌号');
  if (!Number.isFinite(months) || months < 1 || months > 24) return fail('续费月数需为 1~24 的整数');
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE plate_no=?', [plate]);
  if (!veh.length) return fail(`车辆 ${plate} 未登记，请先登记车辆档案`);
  const [rules] = await pool.query('SELECT * FROM fee_rules ORDER BY id LIMIT 1');
  const rule = rules[0] || { monthly_price: 300 };
  const amount = money(num(rule.monthly_price) * months);
  const cur = veh[0].card_expire ? new Date(veh[0].card_expire + ' 23:59:59') : null;
  const start = cur && cur > new Date() ? new Date(cur.getTime() + 86400000) : new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + months);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await pool.query(
    'INSERT INTO payments (vehicle_id, months, amount, start_date, end_date, remark, operator) VALUES (?,?,?,?,?,?,?)',
    [veh[0].id, months, amount, fmt(start), fmt(end), 'AI 助手办理', user.name]);
  await pool.query('UPDATE vehicles SET monthly_card=1, card_expire=? WHERE id=?', [fmt(end), veh[0].id]);
  await log(user.username, 'AI 月卡续费', `${plate} ${months}个月 ¥${amount}`);
  return ok(`已为 ${plate} 续费 ${months} 个月，金额 ${amount.toFixed(2)} 元，月卡有效期至 ${fmt(end)}`, {
    amount, start_date: fmt(start), end_date: fmt(end)
  });
}

async function settleDebt(args, user) {
  const plate = String(args.plate_no || '').trim();
  if (!plate) return fail('请输入车牌号');
  const [[{ cnt, total }]] = await pool.query(
    "SELECT COUNT(*) cnt, IFNULL(SUM(fee),0) total FROM records WHERE plate_no=? AND status='out' AND pay_status='unpaid' AND fee>0",
    [plate]);
  if (!num(cnt)) return fail(`车辆 ${plate} 没有未缴欠费`);
  await pool.query(
    "UPDATE records SET pay_status='paid', actual_fee=fee WHERE plate_no=? AND status='out' AND pay_status='unpaid' AND fee>0",
    [plate]);
  await log(user.username, 'AI 结清欠费', `${plate} ${cnt}笔 ¥${total}`);
  return ok(`已结清 ${plate} 的 ${cnt} 笔欠费，合计 ${money(total).toFixed(2)} 元`, {
    count: num(cnt), total: money(total)
  });
}

async function addSpot(args, user) {
  const spotNo = String(args.spot_no || '').trim();
  const zoneKey = String(args.zone || '').trim();
  const stype = args.stype === 'fixed' ? 'fixed' : 'temporary';
  if (!spotNo || !zoneKey) return fail('车位号和分区必填');
  let zoneRows;
  if (/^\d+$/.test(zoneKey)) {
    [zoneRows] = await pool.query('SELECT * FROM zones WHERE id=?', [Number(zoneKey)]);
  } else {
    [zoneRows] = await pool.query('SELECT * FROM zones WHERE name=?', [zoneKey]);
  }
  if (!zoneRows.length) {
    const [all] = await pool.query('SELECT id, name FROM zones ORDER BY id');
    return fail(`分区"${zoneKey}"不存在，请使用现有分区或先新增分区`, { zones: all.map(z => ({ id: z.id, name: z.name })) });
  }
  try {
    await pool.query(
      "INSERT INTO spots (spot_no, zone_id, stype, status, vehicle_id) VALUES (?,?,?,'free',NULL)",
      [spotNo, zoneRows[0].id, stype]);
    await log(user.username, 'AI 新增车位', `${spotNo} @ ${zoneRows[0].name}`);
    return ok(`已在分区「${zoneRows[0].name}」新增${spotTypeText[stype]}车位 ${spotNo}`, {
      spot_no: spotNo, zone: zoneRows[0].name, type: spotTypeText[stype]
    });
  } catch (e) {
    return fail(e.code === 'ER_DUP_ENTRY' ? `车位号 ${spotNo} 已存在` : `新增车位失败：${e.message}`);
  }
}

async function addZone(args, user) {
  const name = String(args.name || '').trim();
  if (!name) return fail('分区名称不能为空');
  try {
    const [r] = await pool.query('INSERT INTO zones (name, remark) VALUES (?,?)', [name, String(args.remark || '')]);
    await log(user.username, 'AI 新增分区', name);
    return ok(`已新增分区「${name}」`, { id: r.insertId, name });
  } catch (e) {
    return fail(`新增分区失败：${e.message}`);
  }
}

async function updateFeeRules(args, user) {
  const [rows] = await pool.query('SELECT * FROM fee_rules ORDER BY id LIMIT 1');
  if (!rows.length) return fail('收费规则不存在');
  const cur = rows[0];
  const next = {
    name: args.name !== undefined ? String(args.name).trim() : cur.name,
    free_minutes: args.free_minutes !== undefined ? Number(args.free_minutes) : num(cur.free_minutes),
    price_per_hour: args.price_per_hour !== undefined ? Number(args.price_per_hour) : num(cur.price_per_hour),
    daily_cap: args.daily_cap !== undefined ? Number(args.daily_cap) : num(cur.daily_cap),
    monthly_price: args.monthly_price !== undefined ? Number(args.monthly_price) : num(cur.monthly_price)
  };
  if (!next.name) return fail('规则名称不能为空');
  if (!Number.isFinite(next.free_minutes) || next.free_minutes < 0) return fail('免费时长必须大于等于 0');
  if (!(next.price_per_hour > 0)) return fail('每小时单价必须大于 0');
  if (!(next.daily_cap > 0)) return fail('每日封顶必须大于 0');
  if (!(next.monthly_price > 0)) return fail('月卡价格必须大于 0');
  try {
    await pool.query(
      'UPDATE fee_rules SET name=?, free_minutes=?, price_per_hour=?, daily_cap=?, monthly_price=? WHERE id=?',
      [next.name, Math.floor(next.free_minutes), next.price_per_hour, next.daily_cap, next.monthly_price, cur.id]);
    await log(user.username, 'AI 修改收费规则', `ID:${cur.id}`);
    return ok(`收费规则已更新：免费 ${Math.floor(next.free_minutes)} 分钟，${next.price_per_hour.toFixed(2)} 元/小时，每日封顶 ${next.daily_cap.toFixed(2)} 元，月卡 ${next.monthly_price.toFixed(2)} 元/月`, next);
  } catch (e) {
    return fail(`修改失败：${e.message}`);
  }
}

/* ============================ 导航工具 ============================ */
const PAGE_PATHS = {
  dashboard: '/dashboard',
  spots: '/spots',
  vehicles: '/vehicles',
  records: '/records',
  payments: '/payments',
  debts: '/debts',
  reports: '/reports',
  rules: '/rules',
  users: '/users',
  logs: '/logs'
};
const PAGE_NAMES = {
  dashboard: '数据看板',
  spots: '车位管理',
  vehicles: '车辆管理',
  records: '进出管理',
  payments: '月卡缴费',
  debts: '欠费管理',
  reports: '报表中心',
  rules: '收费规则',
  users: '系统用户',
  logs: '操作日志'
};

function navigatePage(args, user) {
  const page = String(args.page || '');
  if (!PAGE_PATHS[page]) return fail(`未知页面：${page}`);
  if (page === 'users' && user.role !== 'admin') return fail('仅管理员可以打开系统用户页面');
  const query = {};
  if (page === 'payments' && args.vehicle_id) query.vehicle_id = Number(args.vehicle_id);
  return {
    ok: true,
    summary: `已打开${PAGE_NAMES[page]}页面`,
    navigate: { path: PAGE_PATHS[page], query },
    data: { page, title: PAGE_NAMES[page] }
  };
}

/* ============================ 导出工具 ============================ */
function currentMonthRange() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, d.getMonth() + 1, 0).getDate();
  return { month: `${y}-${m}`, start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
}

function exportIncomeReport(args) {
  const month = /^\d{4}-\d{2}$/.test(String(args.month || '')) ? String(args.month) : currentMonthRange().month;
  return {
    ok: true,
    summary: `已生成 ${month} 收入报表，正在下载`,
    download: { url: `/api/export/income?month=${month}`, filename: `收入报表_${month}.xlsx` },
    data: { month }
  };
}

function exportRecords(args) {
  const range = currentMonthRange();
  let start = /^\d{4}-\d{2}-\d{2}$/.test(String(args.start || '')) ? String(args.start) : range.start;
  let end = /^\d{4}-\d{2}-\d{2}$/.test(String(args.end || '')) ? String(args.end) : range.end;
  if (start > end) {
    const t = start;
    start = end;
    end = t;
  }
  return {
    ok: true,
    summary: `已生成 ${start} ~ ${end} 进出记录，正在下载`,
    download: { url: `/api/export/records?start=${start}&end=${end}`, filename: `进出记录_${start}_${end}.xlsx` },
    data: { start, end }
  };
}

function exportLogs() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return {
    ok: true,
    summary: '已生成操作日志文件，正在下载',
    download: { url: '/api/export/logs', filename: `操作日志_${stamp}.xlsx` },
    data: {}
  };
}

/* ============================ 分发 ============================ */
async function execTool(name, args = {}, user = {}) {
  switch (name) {
    case 'get_dashboard': return getDashboard();
    case 'query_spots': return querySpots(args);
    case 'query_zones': return queryZones();
    case 'query_vehicles': return queryVehicles(args);
    case 'query_records': return queryRecords(args);
    case 'query_debts': return queryDebts(args);
    case 'query_income_report': return queryIncomeReport(args);
    case 'get_fee_rules': return getFeeRules();
    case 'query_payments': return queryPayments(args);
    case 'query_logs': return queryLogs(args);
    case 'query_users': return queryUsers(args, user);
    case 'add_vehicle': return addVehicle(args, user);
    case 'vehicle_entry': return vehicleEntry(args, user);
    case 'vehicle_exit': return vehicleExit(args, user);
    case 'renew_monthly_card': return renewMonthlyCard(args, user);
    case 'settle_debt': return settleDebt(args, user);
    case 'add_spot': return addSpot(args, user);
    case 'add_zone': return addZone(args, user);
    case 'update_fee_rules': return updateFeeRules(args, user);
    case 'navigate_page': return navigatePage(args, user);
    case 'export_income_report': return exportIncomeReport(args);
    case 'export_records': return exportRecords(args);
    case 'export_logs': return exportLogs();
    default: return fail(`不支持的工具：${name}`);
  }
}

module.exports = { toolDefs, execTool, TOOL_TITLES };