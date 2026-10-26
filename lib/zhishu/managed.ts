/**
 * 一键接入开关（前后端共用，不依赖 Node 模块）：为真时 AI 服务只用网站接入码换来的地址和密钥，
 * 界面只保留 K图 的入口。原项目的服务商配置与其它功能代码保留不删，方便以后合并上游。
 * 只有原项目的单元测试会设 ZHISHU_MANAGED_AI=0 跑「自己配服务商」的原行为；桌面壳启动服务时会去掉这个变量。
 */
export const ZHISHU_MANAGED_AI = process.env.ZHISHU_MANAGED_AI !== "0";
