const MONTH_THRESHOLDS = [
  {
    month: 1,
    points: [
      [0, 'A'],
      [7, 'C'],
      [9, 'B'],
      [10, 'A'],
      [11, 'E'],
      [14, 'A'],
      [15, 'B'],
      [16, 'D'],
      [19, 'C'],
      [21, 'B'],
      [23, 'A'],
    ],
  },
  {
    month: 3,
    points: [
      [0, 'A'],
      [7, 'B'],
      [10, 'A'],
      [11, 'E'],
      [14, 'A'],
      [15, 'B'],
      [17, 'D'],
      [20, 'C'],
      [22, 'B'],
      [23, 'A'],
    ],
  },
  {
    month: 6,
    points: [
      [0, 'A'],
      [12, 'B'],
      [16, 'C'],
      [17, 'D'],
      [22, 'C'],
      [23, 'A'],
    ],
  },
  {
    month: 7,
    points: [
      [0, 'A'],
      [7, 'B'],
      [16, 'C'],
      [17, 'D'],
      [22, 'C'],
      [23, 'A'],
    ],
  },
  {
    month: 9,
    points: [
      [0, 'A'],
      [7, 'B'],
      [10, 'A'],
      [11, 'E'],
      [14, 'A'],
      [15, 'B'],
      [16, 'C'],
      [17, 'D'],
      [19, 'C'],
      [21, 'B'],
      [23, 'A'],
    ],
  },
  {
    month: 12,
    points: [
      [0, 'A'],
      [7, 'C'],
      [9, 'B'],
      [10, 'A'],
      [11, 'E'],
      [14, 'A'],
      [15, 'B'],
      [16, 'D'],
      [19, 'C'],
      [21, 'B'],
      [23, 'A'],
    ],
  },
];

const PRICE_BY_CODE = {
  A: 3850,
  B: 5550,
  C: 5850,
  D: 8880,
  E: 2220,
};

const LABEL_BY_CODE = {
  A: 'valley',
  B: 'flat',
  C: 'peak',
  D: 'sharp',
  E: 'deepValley',
};

// 来源：电价.jpg，国网山东省电力公司《2026年居民电动汽车（自行车）充电桩峰谷分时表》。
// price10000 以万分之一元/kWh 表示，每个起点持续到下个起点或午夜。
function presetTariffFor(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const month = Number(date.slice(5, 7));
  if (month < 1 || month > 12) return undefined;
  let schedule = MONTH_THRESHOLDS[0];
  for (const entry of MONTH_THRESHOLDS) {
    if (entry.month > month) break;
    schedule = entry;
  }
  return {
    from: date.slice(0, 4) + '-' + String(schedule.month).padStart(2, '0') + '-01',
    periods: schedule.points.map(([hour, code]) => ({
      start: String(hour).padStart(2, '0') + ':00',
      label: LABEL_BY_CODE[code],
      price10000: PRICE_BY_CODE[code],
    })),
  };
}

module.exports = { presetTariffFor };
