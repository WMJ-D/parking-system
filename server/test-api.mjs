const BASE = 'http://localhost:3001/api';
let token = '';
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}
const ok = (name, cond, extra='') => console.log(`${cond ? 'PASS' : 'FAIL'} - ${name} ${extra}`);

// 登录
const login = await call('POST', '/auth/login', { username: 'admin', password: '123456' });
token = login.data.token;
ok('登录', login.code === 0);
const badLogin = await fetch(BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:'admin',password:'wrong'}) }).then(r=>r.json());
ok('错误密码被拒绝', badLogin.code === 1);
const noAuth = await fetch(BASE + '/dashboard').then(r=>r.status);
ok('无token返回401', noAuth === 401);

// 看板
const dash = await call('GET', '/dashboard');
ok('看板数据', dash.code === 0 && dash.data.spots.total > 0);

// 车辆查询（中文）
const veh = await call('GET', '/vehicles?keyword=' + encodeURIComponent('京A'));
ok('车辆中文搜索', veh.code === 0 && veh.data.length > 0, `命中${veh.data.length}条`);

// 新增车辆
const created = await call('POST', '/vehicles', { plate_no: '测试Z99999', owner_name: '测试用户', vtype: 'temp' });
ok('新增车辆', created.code === 0);

// 入场
const entry = await call('POST', '/records/entry', { plate_no: '测试Z99999' });
ok('车辆入场', entry.code === 0 && entry.data.spotNo, `分配车位 ${entry.data?.spotNo}`);
const dup = await call('POST', '/records/entry', { plate_no: '测试Z99999' });
ok('重复入场被拒绝', dup.code === 1);

// 未登记车辆入场被拒绝
const unreg = await call('POST', '/records/entry', { plate_no: '京X00000' });
ok('未登记车辆拒绝入场', unreg.code === 1);

// 找到该记录，出场结算
const recs = await call('GET', '/records?status=in&keyword=' + encodeURIComponent('测试Z99999'));
const rec = recs.data.list[0];
const fee = await call('GET', `/records/${rec.id}/fee`);
ok('费用预估', fee.code === 0 && typeof fee.data.fee === 'number', `时长${fee.data.hours}h 应收¥${fee.data.fee}`);
const exit = await call('POST', `/records/${rec.id}/exit`, {});
ok('出场结算', exit.code === 0);

// 月卡车辆出场应免费：给京E56789开月卡再入场出场
await call('PUT', `/vehicles/${veh.data.find(v=>v.plate_no.startsWith('京A'))?.id || 1}`, {});
const mv = await call('GET', '/vehicles');
const target = mv.data.find(v => v.plate_no === '京E56789');
await call('PUT', `/vehicles/${target.id}`, { ...target, monthly_card: true, card_expire: '2027-12-31' });
const e2 = await call('POST', '/records/entry', { plate_no: '京E56789' });
ok('月卡车辆入场', e2.code === 0);
const r2 = await call('GET', '/records?status=in&keyword=' + encodeURIComponent('京E56789'));
const f2 = await call('GET', `/records/${r2.data.list[0].id}/fee`);
ok('月卡车辆免费', f2.code === 0 && f2.data.free && f2.data.fee === 0, `fee=${f2.data.fee}`);
await call('POST', `/records/${r2.data.list[0].id}/exit`, {});
const mv2 = await call('GET', '/vehicles');
const t2 = mv2.data.find(v => v.id === target.id);
ok('月卡到期日保留', t2.monthly_card === 1);

// 月卡续费
const pay = await call('POST', '/payments', { vehicle_id: target.id, months: 3 });
ok('月卡续费', pay.code === 0 && pay.data.amount > 0, `¥${pay.data.amount}, 到期${pay.data.end_date}`);

// 收费规则
const rules = await call('GET', '/rules');
ok('收费规则读取', rules.code === 0 && rules.data.length > 0);
const upd = await call('PUT', `/rules/${rules.data[0].id}`, { ...rules.data[0], price_per_hour: 3.5 });
ok('收费规则修改', upd.code === 0);

// 车位增删
const spot = await call('POST', '/spots', { spot_no: 'T-999', zone_id: 2, stype: 'temporary' });
ok('新增车位', spot.code === 0);
const spots = await call('GET', '/spots?keyword=T-999');
const delSpot = await call('DELETE', `/spots/${spots.data[0].id}`);
ok('删除车位', delSpot.code === 0);

// 分区
const zone = await call('POST', '/zones', { name: '测试区', remark: '' });
ok('新增分区', zone.code === 0);

// 用户
const users = await call('GET', '/users');
ok('用户列表', users.code === 0 && users.data.length >= 2);
const newUser = await call('POST', '/users', { username: 'lisi', password: 'abc123', name: '李四', role: 'operator' });
ok('新增用户', newUser.code === 0);
const opLogin = await fetch(BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:'lisi',password:'abc123'}) }).then(r=>r.json());
const opDash = await fetch(BASE + '/users', { headers: { Authorization: `Bearer ${opLogin.data.token}` } }).then(r=>r.status);
ok('操作员无权访问用户管理(403)', opDash === 403);

// 日志
const logs = await call('GET', '/logs');
ok('操作日志', logs.code === 0 && logs.data.length > 0, `${logs.data.length}条`);

// 清理测试数据
await call('DELETE', `/users/${users.data.length + 1}`);
console.log('\n全部测试完成');
