// 游戏静态配置：身份 / 地图 / 车型 / 解说文案

export const ROLES = [
  {
    id: 'fugitive',
    name: '大佬（逃犯）',
    sub: '甩掉阿sir，利用高架桥盲区消星，每次消星攒一枚「狂暴」，Shift 释放清场',
    hint: '逃犯：脱离视线可消星，星级归零即逃脱 · 消星得「狂暴」，Shift 释放：15 秒提速 / 免伤 / 撞飞警车 / 推倒树木，但热度飙升',
  },
  {
    id: 'police',
    name: '阿sir（警方）',
    sub: '呼叫直升机 / 破胎器 / 地面队友 / 泰瑟枪，把大佬按在地上',
    hint: '警方：H 直升机 · B 破胎器 · U 队友支援 · T 泰瑟枪（贴近低速目标）',
  },
];

export const MAPS = [
  {
    id: 'la', name: '洛杉矶', sub: '洛圣都同款落日 · 摩天楼 · 棕榈 · 高架桥 · 直升机常驻',
    theme: {
      size: 13, block: 64, road: 16,
      sky: { elevation: 6, azimuth: 200, turbidity: 6, rayleigh: 2.4, mie: 0.006 },
      fog: 0xf0a56a, fogDensity: 0.0014, ambient: 0xffd9c0, ambientIntensity: 0.85, sun: 0xffb070, sunIntensity: 1.9,
      ground: 0x7e7a72, sidewalk: 0xa8a49c, roadColor: 0x2c2c30,
      buildings: { density: 0.92, hMin: 10, hMax: 90, palette: [0xd8cbb8, 0xbfb1a0, 0x8d94a3, 0x6d7a8c, 0xe3d6c4, 0x9aa5b1] },
      trees: { type: 'palm', density: 0.7 },
      overpasses: 2, night: false, emissiveWindows: 0.25,
    },
    heliDefault: true,
  },
  {
    id: 'arkansas', name: '阿肯色州', sub: '乡村公路 · 松林 · PIT 圣地 · 州警一撞一个准',
    theme: {
      size: 13, block: 72, road: 14,
      sky: { elevation: 32, azimuth: 150, turbidity: 3, rayleigh: 1.2, mie: 0.005 },
      fog: 0xcfe3f2, fogDensity: 0.0011, ambient: 0xdfe9f0, ambientIntensity: 0.5, sun: 0xffffff, sunIntensity: 1.8,
      ground: 0x5c8a3c, sidewalk: 0x8b8a7c, roadColor: 0x3b3b3e,
      buildings: { density: 0.22, hMin: 4, hMax: 12, palette: [0xc9b58c, 0xa63a2b, 0xe6e2d3, 0x7a6b55, 0xb7c4c9] },
      trees: { type: 'pine', density: 1.6 },
      overpasses: 1, night: false, emissiveWindows: 0.0,
    },
    heliDefault: false,
  },
  {
    id: 'gsp', name: 'GSP · 佐治亚', sub: '州际高速 · 高架密布 · 传奇警官马修斯不败神话',
    theme: {
      size: 13, block: 68, road: 18,
      sky: { elevation: 14, azimuth: 230, turbidity: 6, rayleigh: 1.8, mie: 0.01 },
      fog: 0xd9c3a5, fogDensity: 0.0013, ambient: 0xffe6cc, ambientIntensity: 0.65, sun: 0xffd0a0, sunIntensity: 1.8,
      ground: 0x6f8a5a, sidewalk: 0x9c9a92, roadColor: 0x333336,
      buildings: { density: 0.55, hMin: 6, hMax: 40, palette: [0xb8a48a, 0x8f7b63, 0xd6ccbc, 0x7f8c8d, 0xa2b1b8] },
      trees: { type: 'pine', density: 0.9 },
      overpasses: 3, night: false, emissiveWindows: 0.1,
      elite: { name: 'GSP 马修斯', skill: 1.35 },
    },
    heliDefault: false,
  },
  {
    id: 'florida', name: '佛罗里达州', sub: '阳光海岸 · 粉彩装饰艺术 · 棕榈大道 · 热浪追逐',
    theme: {
      size: 13, block: 60, road: 16,
      sky: { elevation: 45, azimuth: 120, turbidity: 4, rayleigh: 1.0, mie: 0.006 },
      fog: 0xcfe6ee, fogDensity: 0.0009, ambient: 0xbfe0ea, ambientIntensity: 0.32, sun: 0xfff2d8, sunIntensity: 1.25,
      ground: 0xc9b58f, sidewalk: 0xd6ccb2, roadColor: 0x3a3a3f,
      buildings: { density: 0.75, hMin: 6, hMax: 34, palette: [0xe9a9bb, 0x9fd3e0, 0xf0d98a, 0xa9dcb8, 0xe6e0d2, 0xf0a374] },
      trees: { type: 'palm', density: 1.1 },
      overpasses: 2, night: false, emissiveWindows: 0.05,
    },
    heliDefault: true,
  },
  {
    id: 'brazil', name: '巴西', sub: '夜幕贫民窟 · 彩色矮楼 · 窄巷 · 霓虹夜追',
    theme: {
      size: 13, block: 52, road: 13,
      sky: { elevation: -3, azimuth: 180, turbidity: 12, rayleigh: 3.0, mie: 0.05 },
      fog: 0x1a1830, fogDensity: 0.0028, ambient: 0x5a5a90, ambientIntensity: 0.6, sun: 0xff9a5a, sunIntensity: 0.7,
      ground: 0x3d3428, sidewalk: 0x5a4f40, roadColor: 0x1e1e24,
      buildings: { density: 1.0, hMin: 3, hMax: 16, palette: [0xe74c3c, 0xf39c12, 0x27ae60, 0x2980b9, 0x9b59b6, 0xf1c40f, 0xe67e22, 0x1abc9c] },
      trees: { type: 'palm', density: 0.4 },
      overpasses: 1, night: true, emissiveWindows: 0.75,
    },
    heliDefault: true,
  },
];

// 车辆规格：topSpeed m/s，accel m/s²，grip 侧向抓地(越大越不漂)，steer 转向速率，mass kg
export const CARS = [
  {
    id: 'charger', name: '道奇 充电器', sub: 'Dodge Charger · 阿sir的本命车，V8 高速稳',
    color: 0xb02020, spec: { topSpeed: 62, accel: 8, brake: 26, grip: 5.2, steer: 2.3, mass: 1900, len: 5.0, wid: 2.0, h: 1.4 },
    body: 'sedan', rating: 4,
  },
  {
    id: 'challenger', name: '道奇 挑战者', sub: 'Dodge Challenger · 肌肉车，直线王者，弯道漂移',
    color: 0x111111, spec: { topSpeed: 66, accel: 8.8, brake: 24, grip: 4.2, steer: 2.1, mass: 1950, len: 5.0, wid: 2.05, h: 1.42 },
    body: 'muscle', rating: 4,
  },
  {
    id: 'm5', name: '宝马 M5', sub: 'BMW M5 · 德味均衡，操控与速度兼得',
    color: 0x2b4a9f, spec: { topSpeed: 68, accel: 9, brake: 28, grip: 5.8, steer: 2.5, mass: 1850, len: 4.95, wid: 1.95, h: 1.45 },
    body: 'sedan', rating: 5,
  },
  {
    id: 'corvette', name: '科尔维特', sub: 'Corvette · 美式超跑，极速最快，车身最低',
    color: 0xf2c11f, spec: { topSpeed: 74, accel: 10.2, brake: 27, grip: 5.0, steer: 2.6, mass: 1550, len: 4.65, wid: 1.95, h: 1.22 },
    body: 'sports', rating: 5,
  },
  {
    id: 'modely', name: '特斯拉 Model Y', sub: 'Tesla Model Y · 「邪恶鼠标」，电机瞬时爆发',
    color: 0xe8e8ee, spec: { topSpeed: 60, accel: 11, brake: 30, grip: 5.4, steer: 2.4, mass: 2000, len: 4.75, wid: 1.92, h: 1.62 },
    body: 'suv', rating: 3,
  },
];

export const QUOTES = {
  intro: [
    '警灯一开，悠哉悠哉——蹲下就开始。',
    '战力展示完毕，本场晋级赛，正式发车！',
    '匹配成功，阿sir已就位，大佬请开始你的表演。',
  ],
  starUp: ['晋级赛来了！大佬升星，阿sir加派人手。', '大佬越跑越勇，通缉星级 +1！', '这波操作，直接晋级！'],
  starDown: ['消星 -1！苟住，别露头。', '视线丢失，阿sir一脸茫然。', '高架桥下静悄悄，星星掉一个。'],
  escaped: ['他做到了。他争取到了——最后的自由。', '拉爆全场，阿sir下班，大佬回家吃饭。'],
  arrested: ['匹配成功！阿sir收工，局长夫人在等我呢。', '大佬到站，请携带好随身物品下车。', '铁头娃被拿下，本局结束。'],
  spike: ['破胎器命中！轮胎在冒烟，大佬在冒汗。', '地面部队发力：破胎器一放，四轮变三轮。'],
  spikeSelf: ['阿sir自己压上破胎器了……这就是所谓的「友军之围」。'],
  heli: ['空中支援到场——天上的眼睛来了。', '直升机起飞，大佬的路线全都写在脸上。'],
  heliRefuel: ['直升机中途加油！大佬：机会来了。'],
  pit: ['PIT！让 PIT 成为一种艺术。', '一个漂亮的 PIT，车尾甩得像扇门。', '大力出奇迹，这一撞值十年功。'],
  taser: ['泰瑟枪出鞘，大佬开始跳舞。', '滋——！泰瑟一响，自由到站。'],
  backup: ['地面部队集结，别的队友已经上路。', '阿sir呼叫支援：兄弟们，上分了。'],
  roadblock: ['前方设卡！局长亲自出动。'],
  blind: ['高架桥盲区！直升机看不见你，抓紧时间。'],
  fugitiveEscaped: ['大佬拉爆了所有人，你的后视镜被他带走了。', '视线彻底丢失，大佬已成传说。'],
  crash: ['这一撞——车牌都飞了。', '大开大合的车技，大起大落的人生。'],
  elite: ['传奇警官马修斯登场，不败神话能否延续？'],
  rageGain: ['消星成功，大佬攒了一口气——Shift 一按，全城遭殃。', '奖励到账：狂暴一枚。留着冲路障，或者现在就发疯。'],
  rage: ['狂暴开启！大佬不跑了，大佬要清场。', '油门到底，警车变保龄球瓶。', '这不是逃亡，这是巡游。'],
  rageEnd: ['狂暴结束，大佬喘口气，阿sir重新集结。', '气放完了，赶紧找桥底。'],
  launch: ['撞飞！阿sir在空中思考人生。', '反 PIT！教科书倒着翻。', '这一撞，局长的夫人都听见了。'],
  smash: ['树倒了，绿化局表示强烈谴责。', '大佬路过，此处已无树。'],
};

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
