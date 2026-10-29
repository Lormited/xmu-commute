export const accountCardStyles = { original: '原版 · 学号在上', stacked: '新版 · 学号在下' } as const;
export const scenarios = {
  normal: '正常', empty: '空集合', loading: '正在加载', offline: '无网络', 'signed-out': '未登录', long: '长内容与锁定',
} as const;
export const methods = { number: '四位数字码', qr: '二维码', radar: '雷达' } as const;
export const outcomes = { success: '签到成功', ended: '签到已结束', failed: '签到失败' } as const;
