// 游戏日志配置表：全部厂商差异集中于此，校准只需改这里的一行数据
// verified 表示是否在真机日志上实测跑通过；false 的条目在缺少对应游戏的机器上会被静默跳过
export const GAME_CONFIGS = [
  {
    id: 'endfield',
    name: '明日方舟：终末地',
    vendor: 'Hypergryph（鹰角）',
    verified: true,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\Hypergryph\\Endfield\\sdklogs'],
    // 显式列候选文件名，按序尝试、命中即止，绝不遍历整个目录
    files: ['u8sdk_hg_pc.log', 'hgsdk_pc.log', 'u8sdk_pc.log'],
    // 只认「进入登录回调」语义；不能用宽松的 /login/i —— 启动器日志里全是反向噪音
    loginRegexes: [/enter LoginCallback/, /enter HGU8SDKLogin/, /LoginStatus:\s*2/]
  },
  {
    id: 'genshin',
    name: '原神',
    vendor: 'miHoYo（米哈游）',
    verified: false,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\miHoYo\\原神'],
    files: ['output_log.txt', 'Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'starrail',
    name: '崩坏：星穹铁道',
    vendor: 'miHoYo（米哈游）',
    verified: false,
    dirs: [
      '%USERPROFILE%\\AppData\\LocalLow\\miHoYo\\崩坏：星穹铁道',
      '%USERPROFILE%\\AppData\\LocalLow\\Cognosphere\\Star Rail'
    ],
    files: ['output_log.txt', 'Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'zzz',
    name: '绝区零',
    vendor: 'miHoYo（米哈游）',
    verified: false,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\miHoYo\\绝区零'],
    files: ['output_log.txt', 'Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'honkai3',
    name: '崩坏3',
    vendor: 'miHoYo（米哈游）',
    verified: false,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\miHoYo\\崩坏3'],
    files: ['output_log.txt', 'Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'wuthering',
    name: '鸣潮',
    vendor: 'Kuro Games（库洛）',
    verified: false,
    dirs: [
      '%LOCALAPPDATA%\\Wuthering Waves\\Saved\\Logs',
      '%USERPROFILE%\\AppData\\LocalLow\\Kuro Games'
    ],
    files: ['Client.log', 'Launch.log', 'Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'nikke',
    name: '胜利女神：妮姬',
    vendor: 'Shift Up / 腾讯（WeGame）',
    verified: true,
    // Unity 日志的登录行没有行内时间戳，正则路径会判不出时间 → 用通用登录判定（时间退回文件修改时间）
    useGeneric: true,
    dirs: [
      '%USERPROFILE%\\AppData\\LocalLow\\com.tencent\\胜利女神：新的希望',
      '%USERPROFILE%\\AppData\\LocalLow\\Shift Up'
    ],
    files: ['Player.log']
  },
  {
    id: 'deepspace',
    name: '恋与深空',
    vendor: 'Papergames（叠纸）',
    verified: false,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\Papergames'],
    files: ['Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'sunborn',
    name: '少女前线2',
    vendor: 'Sunborn（散爆）',
    verified: false,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\Sunborn'],
    files: ['Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'yostar',
    name: '蔚蓝档案',
    vendor: 'Yostar（悠星）',
    verified: false,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\Yostar'],
    files: ['Player.log'],
    loginRegexes: [/Login|login/i]
  },
  {
    id: 'tower',
    name: '幻塔',
    vendor: '完美世界',
    verified: false,
    dirs: ['%USERPROFILE%\\AppData\\LocalLow\\Perfect World'],
    files: ['Player.log'],
    loginRegexes: [/Login|login/i]
  }
]
