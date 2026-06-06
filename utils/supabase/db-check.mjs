/**
 * Supabase 数据库健康检查脚本
 * 用法: node utils/supabase/db-check.mjs
 */

const PROJECT_ID = "wocchwrvlhqdwtvfwfab";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvY2Nod3J2bGhxZHd0dmZ3ZmFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODQ1ODIsImV4cCI6MjA5MTA2MDU4Mn0.BVlVGSpKth0t6kFSAoZSU0N_DzAYpWGAMIn4RhxRswk";
const BASE_URL = `https://${PROJECT_ID}.supabase.co`;

const TABLES = ["captured_info", "knowledge_nodes", "knowledge_links"];

async function checkConnection() {
  console.log("=== Supabase 数据库健康检查 ===\n");
  console.log(`项目: ${PROJECT_ID}`);
  console.log(`URL:  ${BASE_URL}\n`);

  // 0. DNS 解析检查
  console.log("--- 0. DNS 解析 ---");
  try {
    const { lookup } = await import("node:dns/promises");
    const addr = await lookup(`${PROJECT_ID}.supabase.co`);
    console.log(`✓ 解析成功: ${addr.address}\n`);
  } catch (e) {
    console.log(`✗ DNS 解析失败: ${e.code || e.message}`);
    console.log("  可能原因:");
    console.log("  1. Supabase 项目已被暂停或删除");
    console.log("  2. 网络环境无法访问 supabase.co (代理/防火墙)");
    console.log("  3. DNS 服务器未收录此域名\n");
    console.log("  尝试: 检查 https://supabase.com/dashboard 中项目状态");
    console.log("  或者: 设置代理后重试\n");
    return;
  }

  // 1. 测试连接 - 直接查询表（rest/v1/ 根路径需要 service_role key，改用表查询测试）
  console.log("--- 1. 连接测试 ---");
  try {
    const res = await fetch(`${BASE_URL}/rest/v1/${TABLES[0]}?select=*&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Prefer: "count=exact", Range: "0-0" },
    });
    if (res.ok) {
      console.log("✓ 连接成功\n");
    } else {
      const body = await res.text();
      console.log(`✗ 连接失败: ${res.status} ${res.statusText}`);
      console.log(`  ${body}\n`);
      return;
    }
  } catch (e) {
    console.log(`✗ 网络错误: ${e.message}\n`);
    return;
  }

  // 2. 检查各表状态
  console.log("--- 2. 表状态检查 ---\n");
  for (const table of TABLES) {
    // 2a. 获取行数（用 Range 头只取 1 条，看 Content-Range 总数）
    try {
      const countRes = await fetch(`${BASE_URL}/rest/v1/${table}?select=*&limit=1`, {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          Prefer: "count=exact",
          Range: "0-0",
        },
      });

      if (!countRes.ok) {
        const body = await countRes.text();
        console.log(`✗ ${table}: 查询失败 (${countRes.status})`);
        console.log(`  ${body}\n`);
        continue;
      }

      const contentRange = countRes.headers.get("content-range") || "";
      const total = contentRange.split("/")[1] ?? "unknown";
      console.log(`✓ ${table}: 存在, ${total} 行`);

      // 2b. 取 1 条样本数据，展示列结构
      const data = await countRes.json();
      if (data.length > 0) {
        const cols = Object.keys(data[0]);
        console.log(`  列: ${cols.join(", ")}`);
      } else {
        console.log("  (空表)");
      }
      console.log();
    } catch (e) {
      console.log(`✗ ${table}: ${e.message}\n`);
    }
  }

  // 3. Storage 桶检查
  console.log("--- 3. Storage 检查 ---");
  try {
    const bucketRes = await fetch(`${BASE_URL}/storage/v1/bucket`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (bucketRes.ok) {
      const buckets = await bucketRes.json();
      if (buckets.length === 0) {
        console.log("  (无存储桶或无权限列出)");
      } else {
        for (const b of buckets) {
          console.log(`✓ 桶: ${b.name} (公开: ${b.public})`);
        }
      }
    } else {
      console.log(`  无法列出存储桶 (${bucketRes.status})`);
    }
  } catch (e) {
    console.log(`✗ Storage: ${e.message}`);
  }

  // 4. Auth 状态
  console.log("\n--- 4. Auth 检查 ---");
  try {
    const authRes = await fetch(`${BASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (authRes.ok) {
      const user = await authRes.json();
      if (user.id) {
        console.log(`✓ 已登录用户: ${user.id}`);
      } else {
        console.log("  未登录 (使用 anon key，正常)");
      }
    } else {
      console.log("  未登录 (使用 anon key，正常)");
    }
  } catch (e) {
    console.log(`✗ Auth: ${e.message}`);
  }

  console.log("\n=== 检查完成 ===");
}

checkConnection();
