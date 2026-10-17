/* ============================================================
   刘语 · 配置
   ⚠️ 这里的两个值跟班级热搜榜是**同一个数据库**，本来就可以公开：
      权限由数据库那边的 RLS 和函数管，不靠这里保密。
      但 sb_secret_ 开头的那把钥匙绝对不能写进网页。
   ============================================================ */

window.LY_CONFIG = {

  supabaseUrl: "https://jjyospedfdctgjhmhnex.supabase.co",
  anonKey: "sb_publishable_3Hj8gpHOwqcEAozNka_kFQ_GYgxyDOV",

  /* 表名，不用改 */
  sectionTable: "ly_sections",
  quoteTable: "ly_quotes"

};
