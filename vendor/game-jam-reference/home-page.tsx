"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  Check,
  CircuitBoard,
  Clipboard,
  FileArchive,
  GitFork,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { projects, type Project } from "@/lib/projects";

/* ─────────────────────────────────────────────────────────
 * PAGE CONTENT STORYBOARD
 *
 * Static header and hero are immediately visible and interactive.
 * Secondary sections cascade without delaying the first action.
 *
 *    0ms   header + hero ready
 *  120ms   event status strip rises in
 *  260ms   work gallery and cards rise in
 *  420ms   firmware contract section rises in
 *  560ms   submission lab rises in
 * ───────────────────────────────────────────────────────── */

const TIMING = {
  status: 120,
  gallery: 260,
  contract: 420,
  submit: 560,
};

const SECTION_SPRING = { type: "spring" as const, stiffness: 330, damping: 30 };
const CARD_SPRING = { type: "spring" as const, stiffness: 280, damping: 27 };
const CATEGORIES = ["全部", "互动游戏", "随身工具", "城市社交", "实验作品"] as const;
const MAX_FIRMWARE_BYTES = 0x690000;
const CONTRACT_VERSION = "herstory-event-v1";
const numberFormatter = new Intl.NumberFormat("zh-CN");

type ValidationResult = {
  title: string;
  appId: string;
  version: string;
  firmwareName: string;
  firmwareSize: number;
  sha256: string;
};

type SubmitState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "success"; result: ValidationResult; copied: boolean };

function bytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (item) => item.toString(16).padStart(2, "0")).join("");
}

function ProjectCard({ project, index, visible }: { project: Project; index: number; visible: boolean }) {
  return (
    <motion.article
      className="project-card flex min-h-80 flex-col justify-between rounded-3xl border border-border bg-card p-5 text-card-foreground md:p-6"
      data-accent={project.accent}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 18 }}
      transition={{ ...CARD_SPRING, delay: index * 0.06 }}
    >
      <div>
        <div className="flex items-start justify-between gap-4">
          <span className="tag-paper rounded-full px-3 py-1 font-mono text-xs font-bold">{project.category}</span>
          <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
        </div>
        <div className="my-8 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm" aria-hidden="true">
          {project.accent === "mint" ? <Sparkles /> : project.accent === "gold" ? <CircuitBoard /> : <span className="font-serif text-3xl">女</span>}
        </div>
        <h3 className="font-serif text-2xl font-bold tracking-tight">{project.title}</h3>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{project.description}</p>
      </div>
      <div className="mt-8 space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
          <span>by {project.author}</span><span>v{project.version}</span><span>{project.size}</span><span>{numberFormatter.format(project.installs)} 次安装</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${project.status === "verified" ? "text-success" : "text-muted-foreground"}`}>
            {project.status === "verified" ? <BadgeCheck size={16} aria-hidden="true" /> : <CircuitBoard size={16} aria-hidden="true" />}
            {project.status === "verified" ? "固件协议通过" : "审核中"}
          </span>
          <a
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors duration-100 hover:bg-primary/90"
            href="https://ai-passport.folotoy.cn/tools/web-flasher/"
            target="_blank"
            rel="noreferrer"
          >
            安装说明 <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
    </motion.article>
  );
}

export function HomePage() {
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState(0);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("全部");
  const [query, setQuery] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const firstErrorTarget = useRef<HTMLInputElement>(null);
  const starterRepoUrl = process.env.NEXT_PUBLIC_STARTER_REPO_URL ?? "https://github.com/Jiajia-Chen/herstory-ai-passport-starter";

  useEffect(() => {
    if (reducedMotion) {
      const timer = window.setTimeout(() => setStage(4), 0);
      return () => window.clearTimeout(timer);
    }
    const timers = [
      window.setTimeout(() => setStage(1), TIMING.status),
      window.setTimeout(() => setStage(2), TIMING.gallery),
      window.setTimeout(() => setStage(3), TIMING.contract),
      window.setTimeout(() => setStage(4), TIMING.submit),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [reducedMotion]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (category !== "全部") url.searchParams.set("category", category);
    else url.searchParams.delete("category");
    window.history.replaceState({}, "", url);
  }, [category, query]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesCategory = category === "全部" || project.category === category;
      const matchesQuery = !needle || `${project.title} ${project.author} ${project.description}`.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  async function validateSubmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState({ kind: "loading" });
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const manifest = form.get("manifest");
    const firmware = form.get("firmware");

    try {
      if (!title) throw new Error("请填写作品名称。");
      if (!(manifest instanceof File) || manifest.size === 0) throw new Error("请选择 event-app.json。 ");
      if (!(firmware instanceof File) || firmware.size === 0) throw new Error("请选择完整的 full.bin 固件。");
      if (!firmware.name.endsWith("-full.bin")) throw new Error("固件文件名必须以 -full.bin 结尾，不能上传 app-only 固件。");
      if (firmware.size >= MAX_FIRMWARE_BYTES) throw new Error("固件写入范围到达 event_save，无法通过活动协议。");

      const firstByte = new Uint8Array(await firmware.slice(0, 1).arrayBuffer())[0];
      if (firstByte !== 0xe9) throw new Error("固件没有有效的 ESP32 镜像头，请重新导出完整固件。");

      const parsed = JSON.parse(await manifest.text()) as Record<string, unknown>;
      const appId = String(parsed.app_id ?? "");
      const version = String(parsed.version ?? "");
      const quota = Number(parsed.save_quota_bytes ?? 0);
      if (parsed.contract_version !== CONTRACT_VERSION) throw new Error("manifest 不是 herstory-event-v1 协议。");
      if (!/^[a-z][a-z0-9_]{2,14}$/.test(appId)) throw new Error("app_id 必须是 3–15 位小写字母、数字或下划线。");
      if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error("version 必须使用语义化版本，例如 1.0.0。");
      if (!Number.isInteger(quota) || quota < 1 || quota > 2048) throw new Error("存档配额必须在 1–2048 字节之间。");

      const digest = await crypto.subtle.digest("SHA-256", await firmware.arrayBuffer());
      setSubmitState({
        kind: "success",
        copied: false,
        result: { title, appId, version, firmwareName: firmware.name, firmwareSize: firmware.size, sha256: hex(digest) },
      });
    } catch (error) {
      setSubmitState({ kind: "error", message: error instanceof Error ? error.message : "校验失败，请检查文件。" });
      window.setTimeout(() => firstErrorTarget.current?.focus(), 0);
    }
  }

  async function copyReviewSummary() {
    if (submitState.kind !== "success") return;
    const { result } = submitState;
    await navigator.clipboard.writeText([
      `作品：${result.title}`,
      `app_id：${result.appId}`,
      `版本：${result.version}`,
      `固件：${result.firmwareName} (${bytes(result.firmwareSize)})`,
      `SHA-256：${result.sha256}`,
      `协议：${CONTRACT_VERSION}`,
    ].join("\n"));
    setSubmitState({ ...submitState, copied: true });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
          <a className="focus-ring inline-flex min-h-11 items-center gap-3 rounded-full px-2 font-serif text-lg font-bold" href="#top">
            <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">H</span>
            <span className="hidden sm:inline">HERSTORY GAME JAM</span>
          </a>
          <nav aria-label="主导航" className="flex items-center gap-1">
            <a className="focus-ring min-h-11 rounded-full px-3 py-3 text-sm font-bold hover:bg-muted" href="#works">作品</a>
            <a className="focus-ring min-h-11 rounded-full px-3 py-3 text-sm font-bold hover:bg-muted" href="#starter">开发规则</a>
            <a className="focus-ring min-h-11 rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90" href="#submit">提交作品</a>
          </nav>
        </div>
      </header>

      <section id="top" className="paper-noise relative border-b border-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-[1.2fr_.8fr] md:px-6 md:py-24 lg:px-8">
          <div className="relative z-10">
            <p className="mb-5 font-mono text-xs font-bold tracking-widest text-primary">HERSTORY POP-UP CITY · AI HARDWARE</p>
            <h1 className="max-w-4xl font-serif text-5xl font-black leading-none tracking-tight md:text-7xl lg:text-8xl">把玩法写进<br /><span className="text-primary">一座临时城市。</span></h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">发现现场诞生的 AI Passport 游戏、工具与社交实验。每份固件先通过统一分区和存档协议，再交到玩家手里。</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-bold text-primary-foreground hover:bg-primary/90" href="#works">逛逛作品 <ArrowDownToLine size={18} aria-hidden="true" /></a>
              <a className="focus-ring inline-flex min-h-12 items-center gap-2 rounded-full border border-foreground px-6 font-bold hover:bg-card" href="#starter">获取 Starter Repo <GitFork size={18} aria-hidden="true" /></a>
            </div>
          </div>
          <div className="relative min-h-72 md:min-h-full" aria-hidden="true">
            <div className="scribble-frame absolute inset-x-8 top-10 rotate-2 rounded-[40%_60%_46%_54%/56%_42%_58%_44%] bg-primary-soft p-8 md:inset-x-4">
              <div className="rounded-[52%_48%_58%_42%/46%_56%_44%_54%] bg-card p-7 text-center">
                <CircuitBoard className="mx-auto text-primary" size={72} strokeWidth={1.4} />
                <p className="mt-4 font-serif text-3xl font-black">WEAR · PLAY · CREATE</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">ESP32-C3 / 8MB FLASH / 3 BUTTONS</p>
              </div>
            </div>
            <div className="starburst absolute right-0 top-0">GAME<br />JAM</div>
            <div className="absolute bottom-4 left-0 -rotate-6 rounded-full bg-mint px-5 py-3 font-serif text-lg font-black text-mint-foreground">不按说明书生活</div>
          </div>
        </div>
        <div className="torn-rule" />
      </section>

      <motion.section
        className="border-b border-border bg-primary text-primary-foreground"
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: stage >= 1 ? 1 : 0, y: stage >= 1 ? 0 : 14 }} transition={SECTION_SPRING}
      >
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:grid-cols-3 md:px-6 lg:px-8">
          <div><p className="font-mono text-xs opacity-70">01 / CONTRACT</p><p className="mt-1 font-serif text-xl font-bold">存档跨固件保留</p></div>
          <div><p className="font-mono text-xs opacity-70">02 / REVIEW</p><p className="mt-1 font-serif text-xl font-bold">分区与镜像自动检查</p></div>
          <div><p className="font-mono text-xs opacity-70">03 / INSTALL</p><p className="mt-1 font-serif text-xl font-bold">只刷一个 full.bin 到 0x0</p></div>
        </div>
      </motion.section>

      <motion.section id="works" className="mx-auto max-w-7xl px-4 py-20 md:px-6 lg:px-8" initial={{ opacity: 0, y: 18 }} animate={{ opacity: stage >= 2 ? 1 : 0, y: stage >= 2 ? 0 : 18 }} transition={SECTION_SPRING}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="font-mono text-xs font-bold tracking-widest text-primary">PLAYABLE ARCHIVE / 玩法档案</p><h2 className="mt-3 font-serif text-4xl font-black tracking-tight md:text-6xl">现场正在长出来的作品</h2><p className="mt-4 max-w-2xl text-muted-foreground">筛选、查看协议状态，并前往安全安装流程。</p></div>
          <label className="relative block w-full max-w-sm">
            <span className="sr-only">搜索作品</span><Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} aria-hidden="true" />
            <input className="focus-ring min-h-12 w-full rounded-full border border-border bg-card py-3 pl-11 pr-4 text-sm" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作品或作者" autoComplete="off" />
          </label>
        </div>
        <div className="mt-8 flex flex-wrap gap-2" aria-label="作品分类">
          {CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`focus-ring min-h-11 rounded-full border px-4 text-sm font-bold transition-colors duration-100 ${category === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}>{item}</button>)}
        </div>
        {filtered.length > 0 ? (
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">{filtered.map((project, index) => <ProjectCard key={project.id} project={project} index={index} visible={stage >= 2} />)}</div>
        ) : (
          <div className="mt-10 rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center"><Search className="mx-auto text-primary" size={40} aria-hidden="true" /><h3 className="mt-4 font-serif text-2xl font-bold">这条街暂时没有匹配作品</h3><p className="mt-2 text-sm text-muted-foreground">换一个分类或清空搜索词，再逛一圈。</p><button className="focus-ring mt-5 min-h-11 rounded-full bg-primary px-5 font-bold text-primary-foreground" type="button" onClick={() => { setCategory("全部"); setQuery(""); }}>显示全部作品</button></div>
        )}
      </motion.section>

      <motion.section id="starter" className="border-y border-border bg-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 18 }} transition={SECTION_SPRING}>
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 md:grid-cols-[.8fr_1.2fr] md:px-6 lg:px-8">
          <div><span className="tag-paper inline-flex rounded-full bg-lavender px-4 py-2 font-mono text-xs font-bold text-lavender-foreground">HERSTORY-EVENT-V1</span><h2 className="mt-5 font-serif text-4xl font-black tracking-tight md:text-5xl">同一套烧写规则，给每一位开发者。</h2><p className="mt-5 leading-7 text-muted-foreground">Agent 读规则、组件保护存档、校验器拒绝不兼容固件。不是靠记忆，是写进仓库的三层约束。</p><a className="focus-ring mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-bold text-primary-foreground" href={starterRepoUrl}>打开 Starter Repo <GitFork size={18} aria-hidden="true" /></a></div>
          <ol className="grid gap-4">
            {[
              ["01", "Agent 先读规则", "AGENTS.md 与 event-app-develop 固定分区、应用 ID、存档配额和交付方式。"],
              ["02", "应用只调用统一存档", "event_storage 将每个作品隔离在自己的命名空间，默认记录不超过 2 KB。"],
              ["03", "构建与上传双重校验", "分区哈希、写入范围、full.bin、manifest 和危险擦除 API 都会被检查。"],
            ].map(([number, title, copy]) => <li key={number} className="grid grid-cols-[auto_1fr] gap-4 rounded-3xl border border-border bg-background p-5"><span className="font-mono text-xl font-black text-primary">{number}</span><div><h3 className="font-serif text-xl font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p></div></li>)}
          </ol>
        </div>
      </motion.section>

      <motion.section id="submit" className="mx-auto max-w-7xl px-4 py-20 md:px-6 lg:px-8" initial={{ opacity: 0, y: 18 }} animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 18 }} transition={SECTION_SPRING}>
        <div className="grid gap-10 lg:grid-cols-[.72fr_1.28fr]">
          <div><p className="font-mono text-xs font-bold tracking-widest text-primary">SUBMISSION LAB / 投稿实验室</p><h2 className="mt-3 font-serif text-4xl font-black tracking-tight md:text-6xl">先检查，再上架。</h2><p className="mt-5 leading-7 text-muted-foreground">文件只在你的浏览器中读取，不会上传服务器。通过后复制审核摘要，连同固件提交给组织方。</p><div className="mt-8 rounded-3xl bg-gold p-5 text-gold-foreground"><ShieldCheck size={28} aria-hidden="true" /><p className="mt-3 font-bold">本地预检包含</p><p className="mt-1 text-sm leading-6">协议版本、app_id、存档配额、完整镜像头、文件命名、写入范围和 SHA-256。</p></div></div>
          <form className="rounded-3xl border border-border bg-card p-5 md:p-8" onSubmit={validateSubmission} noValidate>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2"><label className="text-sm font-bold" htmlFor="title">作品名称 *</label><input ref={firstErrorTarget} className="focus-ring mt-2 min-h-12 w-full rounded-2xl border border-border bg-background px-4" id="title" name="title" type="text" autoComplete="off" required placeholder="例如：女书秘密交换机" /></div>
              <div><label className="text-sm font-bold" htmlFor="author">作者 / 团队 *</label><input className="focus-ring mt-2 min-h-12 w-full rounded-2xl border border-border bg-background px-4" id="author" name="author" type="text" autoComplete="name" required placeholder="你的名字或团队名" /></div>
              <div><label className="text-sm font-bold" htmlFor="category">作品类型 *</label><select className="focus-ring mt-2 min-h-12 w-full rounded-2xl border border-border bg-background px-4" id="category" name="category" defaultValue="互动游戏">{CATEGORIES.slice(1).map((item) => <option key={item}>{item}</option>)}</select></div>
              <div className="md:col-span-2"><label className="text-sm font-bold" htmlFor="description">一句话介绍 *</label><textarea className="focus-ring mt-2 min-h-28 w-full resize-y rounded-2xl border border-border bg-background p-4" id="description" name="description" required maxLength={180} placeholder="说明用户拿起 Passport 后会体验什么。" /><p className="mt-2 text-xs text-muted-foreground">最多 180 字。请写具体动作，不写泛泛的 AI 宣言。</p></div>
              <fieldset className="md:col-span-2"><legend className="text-sm font-bold">固件文件 *</legend><div className="mt-2 grid gap-3 md:grid-cols-2"><label className="focus-ring flex min-h-28 cursor-pointer flex-col justify-center rounded-2xl border border-dashed border-border bg-background p-4"><span className="flex items-center gap-2 font-bold"><FileArchive size={18} aria-hidden="true" /> event-app.json</span><span className="mt-1 text-xs text-muted-foreground">活动身份与协议清单</span><input className="mt-3 text-xs" type="file" id="manifest" name="manifest" accept="application/json,.json" required /></label><label className="focus-ring flex min-h-28 cursor-pointer flex-col justify-center rounded-2xl border border-dashed border-border bg-background p-4"><span className="flex items-center gap-2 font-bold"><UploadCloud size={18} aria-hidden="true" /> *-full.bin</span><span className="mt-1 text-xs text-muted-foreground">完整合并固件，只选一个文件</span><input className="mt-3 text-xs" type="file" id="firmware" name="firmware" accept=".bin,application/octet-stream" required /></label></div></fieldset>
              <div className="md:col-span-2"><label className="text-sm font-bold" htmlFor="cover">封面图（可选）</label><input className="focus-ring mt-2 min-h-12 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm" id="cover" name="cover" type="file" accept="image/png,image/jpeg,image/webp" /><p className="mt-2 text-xs text-muted-foreground">建议 4:3，PNG / JPG / WebP，不超过 3 MB。</p></div>
            </div>

            {submitState.kind === "error" && <div className="mt-6 flex gap-3 rounded-2xl border border-danger/30 bg-danger/8 p-4 text-sm" role="alert"><XCircle className="shrink-0 text-danger" size={20} aria-hidden="true" /><div><p className="font-bold text-danger">未通过预检</p><p className="mt-1 text-muted-foreground">{submitState.message}</p></div></div>}
            {submitState.kind === "success" && <div className="mt-6 rounded-2xl border border-success/30 bg-mint p-4 text-mint-foreground"><div className="flex items-center gap-2 font-bold"><Check size={20} aria-hidden="true" /> 本地预检通过</div><dl className="mt-3 grid gap-2 font-mono text-xs"><div><dt className="inline opacity-65">app_id </dt><dd className="inline">{submitState.result.appId}</dd></div><div><dt className="inline opacity-65">firmware </dt><dd className="inline">{bytes(submitState.result.firmwareSize)}</dd></div><div className="break-all"><dt className="inline opacity-65">sha256 </dt><dd className="inline">{submitState.result.sha256}</dd></div></dl><button className="focus-ring mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 font-bold text-background" type="button" onClick={copyReviewSummary}><Clipboard size={16} aria-hidden="true" />{submitState.copied ? "已复制" : "复制审核摘要"}</button></div>}

            <button className="focus-ring mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-60" type="submit" disabled={submitState.kind === "loading"} aria-busy={submitState.kind === "loading"}>{submitState.kind === "loading" ? "正在读取并校验…" : <>开始本地预检 <Send size={18} aria-hidden="true" /></>}</button>
          </form>
        </div>
      </motion.section>

      <footer className="border-t border-border bg-foreground text-background"><div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 md:flex-row md:items-end md:justify-between md:px-6 lg:px-8"><div><p className="font-serif text-3xl font-black">Herstory Pop-up City Game Jam</p><p className="mt-2 max-w-xl text-sm opacity-70">一块开放式 AI 硬件，进入真实城市生活。玩法会被刷掉，创造不会。</p></div><div className="flex flex-wrap gap-4 text-sm font-bold"><a className="focus-ring min-h-11 rounded-full px-3 py-3" href="#works">作品</a><a className="focus-ring min-h-11 rounded-full px-3 py-3" href="#starter">规则</a><a className="focus-ring min-h-11 rounded-full px-3 py-3" href="#submit">投稿</a></div></div></footer>
    </main>
  );
}
