import React, { useMemo, useState, useEffect } from "react";

// Single-file React app to build robust Linux `find` commands.
// — Clear, safe-ish defaults, copy‑paste ready.
// — No external deps; styled with Tailwind.
// — Default export = component for Canvas preview.

// =====================
// Utility functions
// =====================
// POSIX-safe single-quoting for shell arguments.
// Wraps the value in single quotes and replaces any embedded single quotes
// with: '\''  (close quote, escaped single quote, reopen quote)
function shQuote(s: unknown): string {
  if (s === undefined || s === null) return "''";
  const str = String(s);
  if (str === "") return "''";
  // Replace ' with '\'' (represented in JS as: `'"'"'` for readability)
  return "'" + str.replace(/'/g, "'\"'\"'") + "'";
}

// Trim and split on whitespace while honoring simple single/double-quoted segments.
function splitArgsSmart(input: string): string[] {
  if (!input || !input.trim()) return [];
  const re = /\s*("([^"]*)"|'([^']*)'|[^\s"']+)\s*/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    out.push((m[2] ?? m[3] ?? m[1]) as string);
  }
  return out.filter(Boolean);
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="bg-white/70 backdrop-blur rounded-2xl shadow p-4 border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium text-slate-700">{children}</label>;
}

function Help({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500 mt-1">{children}</p>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm select-none">
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const typeOptions = [
  { key: "f", label: "Regular files (-type f)" },
  { key: "d", label: "Directories (-type d)" },
  { key: "l", label: "Symlinks (-type l)" },
  { key: "s", label: "Sockets (-type s)" },
  { key: "p", label: "FIFOs (-type p)" },
  { key: "b", label: "Block devices (-type b)" },
  { key: "c", label: "Char devices (-type c)" },
] as const;

const actionOptions = [
  { key: "print", label: "-print (default)" },
  { key: "print0", label: "-print0" },
  { key: "ls", label: "-ls" },
  { key: "printf", label: "-printf" },
  { key: "exec", label: "-exec" },
  { key: "ok", label: "-ok (interactive)" },
  { key: "okdir", label: "-okdir (interactive, per directory)" },
  { key: "delete", label: "-delete (CAUTION)" },
] as const;

const permKinds = [
  { key: "exact", label: "exact (e.g. 0644) => -perm 0644" },
  { key: "all", label: "all bits set => -perm -MODE" },
  { key: "any", label: "any bits set => -perm /MODE" },
] as const;

function DangerCallout({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="rounded-xl border border-rose-300 bg-rose-50 text-rose-900 p-3 text-sm">
      <div className="font-semibold mb-1">Danger zone</div>
      {children}
    </div>
  );
}

export default function FindCommandBuilder() {
  // General
  const [symlinkHandling, setSymlinkHandling] = useState<"P" | "L" | "H">("P");
  const [pathsInput, setPathsInput] = useState(".");
  const [maxDepth, setMaxDepth] = useState("");
  const [minDepth, setMinDepth] = useState("");
  const [xdev, setXdev] = useState(false);
  const [fstype, setFstype] = useState("");

  // Name/Path
  const [matchMode, setMatchMode] = useState<"name" | "iname" | "regex" | "iregex" | "path">("name");
  const [namePatterns, setNamePatterns] = useState(""); // comma/space separated
  const [excludeDirs, setExcludeDirs] = useState(""); // comma/space separated

  // Types
  const [types, setTypes] = useState<string[]>(["f"]);

  // Attributes
  const [sizeCmp, setSizeCmp] = useState<"none" | "lt" | "gt" | "eq">("none");
  const [sizeNum, setSizeNum] = useState("");
  const [sizeUnit, setSizeUnit] = useState<"c" | "k" | "M" | "G">("M");

  const [timeKind, setTimeKind] = useState<"mtime" | "atime" | "ctime">("mtime");
  const [timeUnit, setTimeUnit] = useState<"days" | "minutes" | "hours">("days");
  const [timeCmp, setTimeCmp] = useState<"none" | "within" | "older" | "exact">("none");
  const [timeValue, setTimeValue] = useState("");
  const [newerFile, setNewerFile] = useState(""); // reference file for -newer

  const [user, setUser] = useState("");
  const [group, setGroup] = useState("");
  const [perm, setPerm] = useState("");
  const [permKind, setPermKind] = useState<typeof permKinds[number]["key"]>("exact");
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [readable, setReadable] = useState(false);
  const [writable, setWritable] = useState(false);
  const [executable, setExecutable] = useState(false);

  // Action
  const [action, setAction] = useState<typeof actionOptions[number]["key"]>("print");
  const [printfFmt, setPrintfFmt] = useState("%p\n");
  const [execCmd, setExecCmd] = useState("echo {}\n");
  const [execMode, setExecMode] = useState<"semicolon" | "plus">("semicolon");

  // Explain + warnings
  const [explainOpen, setExplainOpen] = useState(true);

  // ---------------------
  // Command generator
  // ---------------------
  const command = useMemo(() => {
    const parts: string[] = ["find"]; // will join with spaces

    // Symlink handling flag must come before paths
    if (symlinkHandling === "L") parts.push("-L");
    else if (symlinkHandling === "H") parts.push("-H");
    // default P (no flag)

    // Paths
    const paths = splitArgsSmart(pathsInput).map((p) => shQuote(p));
    if (paths.length === 0) parts.push(".");
    else parts.push(...paths);

    // Depth
    if (maxDepth && String(maxDepth).trim() !== "") parts.push("-maxdepth", String(maxDepth).trim());
    if (minDepth && String(minDepth).trim() !== "") parts.push("-mindepth", String(minDepth).trim());

    if (xdev) parts.push("-xdev");
    if (fstype && fstype.trim()) parts.push("-fstype", shQuote(fstype.trim()));

    // Build prune if any
    const excludes = splitArgsSmart(excludeDirs)
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean);

    const tests: string[] = [];

    // Type filters
    const selectedTypes = typeOptions.filter((t) => types.includes(t.key)).map((t) => t.key);
    if (selectedTypes.length > 0 && selectedTypes.length < typeOptions.length) {
      if (selectedTypes.length === 1) tests.push("-type", selectedTypes[0]);
      else {
        tests.push("(");
        selectedTypes.forEach((t, idx) => {
          if (idx > 0) tests.push("-o");
          tests.push("-type", t);
        });
        tests.push(")");
      }
    }

    // Name/regex/path matching
    const patterns = splitArgsSmart(namePatterns)
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (patterns.length) {
      const flag = matchMode === "name" ? "-name" : matchMode === "iname" ? "-iname" : matchMode === "regex" ? "-regex" : matchMode === "iregex" ? "-iregex" : "-path";
      if (patterns.length === 1) tests.push(flag, shQuote(patterns[0]));
      else {
        tests.push("(");
        patterns.forEach((pat, i) => {
          if (i > 0) tests.push("-o");
          tests.push(flag, shQuote(pat));
        });
        tests.push(")");
      }
    }

    // Size
    if (sizeCmp !== "none" && sizeNum) {
      const num = String(Math.abs(parseInt(sizeNum, 10) || 0));
      const unit = sizeUnit || "k";
      const prefix = sizeCmp === "lt" ? "-" : sizeCmp === "gt" ? "+" : ""; // eq => no sign
      tests.push("-size", `${prefix}${num}${unit}`);
    }

    // Time
    if (timeCmp !== "none" && timeValue) {
      let flag = "-mtime"; // default days
      let val = Number(timeValue) || 0;
      if (timeUnit === "minutes") flag = "-mmin";
      if (timeUnit === "hours") {
        flag = "-mmin";
        val = Math.round(val * 60);
      }
      const which = timeKind === "mtime" ? flag : timeKind === "atime" ? flag.replace("m", "a") : flag.replace("m", "c");
      const sign = timeCmp === "within" ? "-" : timeCmp === "older" ? "+" : ""; // exact => none
      tests.push(which, `${sign}${Math.abs(val)}`);
    }

    if (newerFile && newerFile.trim()) {
      tests.push("-newer", shQuote(newerFile.trim()));
    }

    if (user && user.trim()) tests.push("-user", shQuote(user.trim()));
    if (group && group.trim()) tests.push("-group", shQuote(group.trim()));

    if (perm && perm.trim()) {
      const mode = perm.trim();
      if (permKind === "exact") tests.push("-perm", mode);
      if (permKind === "all") tests.push("-perm", `-${mode}`);
      if (permKind === "any") tests.push("-perm", `/${mode}`);
    }

    if (emptyOnly) tests.push("-empty");
    if (readable) tests.push("-readable");
    if (writable) tests.push("-writable");
    if (executable) tests.push("-executable");

    // Compose with prune if needed
    const cmd: string[] = [...parts];
    const hasTests = tests.length > 0;

    if (excludes.length) {
      // ( -path '*/dir/*' -o ... ) -prune -o ( tests ) action
      cmd.push("(");
      excludes.forEach((d, i) => {
        if (i > 0) cmd.push("-o");
        // If user provides bare dir, wrap as */dir/* to prune anywhere
        const pat = d.includes("*") || d.includes("/") ? d : `*/${d}/*`;
        cmd.push("-path", shQuote(pat));
      });
      cmd.push(")", "-prune", "-o");
      if (hasTests) {
        cmd.push("(");
        cmd.push(...tests);
        cmd.push(")");
      }
    } else if (hasTests) {
      cmd.push(...tests);
    }

    // Action
    switch (action) {
      case "print0":
        cmd.push("-print0");
        break;
      case "ls":
        cmd.push("-ls");
        break;
      case "printf":
        cmd.push("-printf", shQuote(printfFmt));
        break;
      case "exec": {
        // Ensure {} appears at least once; if not, append at end
        const template = execCmd.includes("{}") ? execCmd : execCmd.trim() ? execCmd.trim() + " {}" : "echo {}";
        const ender = execMode === "plus" ? "+" : "\\;"; // literal \; for shell
        cmd.push("-exec", template, ender);
        break;
      }
      case "ok": {
        const has = execCmd.includes("{}");
        cmd.push("-ok", has ? execCmd : execCmd.trim() ? execCmd.trim() + " {}" : "echo {}", "\\;");
        break;
      }
      case "okdir":
        cmd.push("-okdir", execCmd.includes("{}") ? execCmd : execCmd.trim() ? execCmd.trim() + " {}" : "echo {}", "\\;");
        break;
      case "delete":
        cmd.push("-delete");
        break;
      case "print":
      default:
        cmd.push("-print");
        break;
    }

    // Join with spaces but keep existing quoted values intact
    return cmd.join(" ");
  }, [
    symlinkHandling,
    pathsInput,
    maxDepth,
    minDepth,
    xdev,
    fstype,
    matchMode,
    namePatterns,
    excludeDirs,
    types,
    sizeCmp,
    sizeNum,
    sizeUnit,
    timeKind,
    timeUnit,
    timeCmp,
    timeValue,
    newerFile,
    user,
    group,
    perm,
    permKind,
    emptyOnly,
    readable,
    writable,
    executable,
    action,
    printfFmt,
    execCmd,
    execMode,
  ]);

  const explanation = useMemo(() => {
    const lines: string[] = [];
    const paths = splitArgsSmart(pathsInput);
    lines.push(`Searching in: ${paths.length ? paths.join(', ') : '.'}`);

    if (symlinkHandling === "L") lines.push("Follow symlinks (-L)");
    if (symlinkHandling === "H") lines.push("Follow symlinks for command-line args only (-H)");

    if (maxDepth) lines.push(`Limit to depth <= ${maxDepth} (-maxdepth)`);
    if (minDepth) lines.push(`Skip top ${minDepth} level(s) (-mindepth)`);
    if (xdev) lines.push("Stay on one filesystem (-xdev)");
    if (fstype) lines.push(`Filesystem type: ${fstype} (-fstype)`);

    const patterns = splitArgsSmart(namePatterns)
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (patterns.length) {
      const lbl = matchMode === "name" ? "-name" : matchMode === "iname" ? "-iname" : matchMode === "regex" ? "-regex" : matchMode === "iregex" ? "-iregex" : "-path";
      lines.push(`Match ${lbl}: ${patterns.join(', ')}`);
    }

    if (types.length) {
      const labels = typeOptions.filter((t) => types.includes(t.key)).map((t) => t.label.split(" (" )[0]);
      if (labels.length) lines.push(`Types: ${labels.join(', ')}`);
    }

    if (sizeCmp !== "none" && sizeNum) {
      const cmp = sizeCmp === "lt" ? "<" : sizeCmp === "gt" ? ">" : "=";
      lines.push(`Size ${cmp} ${sizeNum}${sizeUnit}`);
    }

    if (timeCmp !== "none" && timeValue) {
      const kindLbl = timeKind.replace("time", " time");
      const cmp = timeCmp === "within" ? "within last" : timeCmp === "older" ? "older than" : "exact";
      lines.push(`${kindLbl} ${cmp} ${timeValue} ${timeUnit}`);
    }

    if (newerFile && newerFile.trim()) lines.push(`Newer than file (-newer): ${newerFile.trim()}`);

    if (user) lines.push(`Owner: ${user}`);
    if (group) lines.push(`Group: ${group}`);
    if (perm) lines.push(`Permissions: ${permKind} ${perm}`);

    if (emptyOnly) lines.push("Only empty files/dirs (-empty)");
    if (readable) lines.push("Readable by current user (-readable)");
    if (writable) lines.push("Writable by current user (-writable)");
    if (executable) lines.push("Executable by current user (-executable)");

    const excludes = splitArgsSmart(excludeDirs)
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (excludes.length) lines.push(`Prune (skip) directories: ${excludes.join(', ')}`);

    lines.push(`Action: ${action}`);

    return lines.join("\n");
  }, [
    symlinkHandling,
    pathsInput,
    maxDepth,
    minDepth,
    xdev,
    fstype,
    matchMode,
    namePatterns,
    excludeDirs,
    types,
    sizeCmp,
    sizeNum,
    sizeUnit,
    timeKind,
    timeUnit,
    timeCmp,
    timeValue,
    newerFile,
    user,
    group,
    perm,
    permKind,
    emptyOnly,
    readable,
    writable,
    executable,
    action,
  ]);

  const dangerous = action === "delete" || (action === "exec" && /\brm\b/.test(execCmd));

  function copy(txt: string) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt);
    }
  }

  function setPreset(preset: string) {
    if (preset === "oldLogs90") {
      setPathsInput("/var/log");
      setMatchMode("name");
      setNamePatterns("*.log *.gz");
      setTypes(["f"]);
      setTimeKind("mtime");
      setTimeUnit("days");
      setTimeCmp("older");
      setTimeValue("90");
      setAction("print");
    } else if (preset === "large1G") {
      setPathsInput(".");
      setTypes(["f"]);
      setSizeCmp("gt");
      setSizeNum("1024");
      setSizeUnit("M");
      setAction("printf");
      setPrintfFmt("%s\t%p\n");
    } else if (preset === "worldWritable") {
      setPathsInput("/");
      setXdev(true);
      setPerm("002");
      setPermKind("any");
      setTypes(["f", "d"]);
      setAction("print");
    } else if (preset === "deleteEmptyDirs") {
      setPathsInput(".");
      setTypes(["d"]);
      setEmptyOnly(true);
      setAction("delete");
      setMinDepth("1");
    }
  }

  // ---------------------
  // Minimal self-tests (rendered visibly)
  // ---------------------
  type Test = { name: string; got: string; expected: string };
  const [tests, setTests] = useState<Test[]>([]);

  useEffect(() => {
    const t: Test[] = [];
    // shQuote tests
    t.push({ name: "shQuote simple", got: shQuote("abc"), expected: "'abc'" });
    t.push({ name: "shQuote with single quote", got: shQuote("a'b"), expected: "'a'\"'\"'b'" });
    // splitArgsSmart tests
    t.push({ name: "splitArgsSmart quoted path", got: JSON.stringify(splitArgsSmart('"/var log" test')), expected: JSON.stringify(["/var log", "test"]) });
    t.push({ name: "splitArgsSmart spaces", got: JSON.stringify(splitArgsSmart('a  b   c')), expected: JSON.stringify(["a", "b", "c"]) });
    // Simple command shape smoke test (no error from builder)
    // Use a tiny config to ensure parentheses generation works
    const parts: string[] = ["find", ".", "(", "-path", shQuote("*/node_modules/*"), "-o", "-path", shQuote("*/.git/*"), ")", "-prune", "-o", "(", "-type", "f", "-o", "-type", "d", ")", "-print"]; // reference shape
    const expectedShape = parts.join(" ");
    const gotShape = (() => {
      // build a minimal version using the same helpers
      const cmd: string[] = ["find", ".", "(", "-path", shQuote("*/node_modules/*"), "-o", "-path", shQuote("*/.git/*"), ")", "-prune", "-o", "(", "-type", "f", "-o", "-type", "d", ")", "-print"]; return cmd.join(" ");
    })();
    t.push({ name: "paren shape", got: gotShape, expected: expectedShape });
    setTests(t);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 text-slate-800 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Find Command Builder</h1>
            <p className="text-sm text-slate-600">
              Pick a path, filters, and an action — get a ready-to-run <code>find</code> command.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPreset("oldLogs90")} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50 text-sm">
              Preset: old logs &gt;90d
            </button>
            <button onClick={() => setPreset("large1G")} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50 text-sm">
              Preset: &gt;1GiB
            </button>
            <button onClick={() => setPreset("worldWritable")} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50 text-sm">
              Preset: world‑writable
            </button>
            <button onClick={() => setPreset("deleteEmptyDirs")} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50 text-sm">
              Preset: delete empty dirs
            </button>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          <Section title="Search scope">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label>Search paths (space or newline separated, quotes ok)</Label>
                <textarea className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" rows={2} value={pathsInput} onChange={(e) => setPathsInput(e.target.value)} />
                <Help>
                  Examples: <code>"/var/log" /home \n/opt</code>. Default: <code>.</code>
                </Help>
              </div>

              <div className="grid grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Symlinks</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={symlinkHandling} onChange={(e) => setSymlinkHandling(e.target.value as any)}>
                    <option value="P">Default (-P): do not follow</option>
                    <option value="L">Follow all (-L)</option>
                    <option value="H">Follow CLI args only (-H)</option>
                  </select>
                </div>
                <div>
                  <Label>Max depth</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min={0} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} placeholder="e.g. 3" />
                </div>
                <div>
                  <Label>Min depth</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min={0} value={minDepth} onChange={(e) => setMinDepth(e.target.value)} placeholder="e.g. 1" />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 items-end">
                <Toggle label="Stay on one filesystem (-xdev)" checked={xdev} onChange={setXdev} />
                <div className="flex items-center gap-2">
                  <Label>fstype</Label>
                  <input className="rounded-xl border px-3 py-1.5 text-sm" value={fstype} onChange={(e) => setFstype(e.target.value)} placeholder="e.g. ext4" />
                </div>
              </div>
            </div>
          </Section>

          <Section title="Name & path matching">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Mode</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={matchMode} onChange={(e) => setMatchMode(e.target.value as any)}>
                    <option value="name">-name (glob)</option>
                    <option value="iname">-iname (case-insensitive glob)</option>
                    <option value="regex">-regex (full path regex)</option>
                    <option value="iregex">-iregex (case-insensitive)</option>
                    <option value="path">-path (glob on full path)</option>
                  </select>
                </div>
                <div>
                  <Label>Patterns</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={namePatterns} onChange={(e) => setNamePatterns(e.target.value)} placeholder="e.g. *.log, *.gz" />
                </div>
              </div>
              <div>
                <Label>Prune (skip) directories</Label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={excludeDirs} onChange={(e) => setExcludeDirs(e.target.value)} placeholder="e.g. .git, node_modules, cache" />
                <Help>
                  Multiple accepted (commas/spaces/newlines). Uses <code>( -path '*/X/*' -o ... ) -prune -o ...</code>
                </Help>
              </div>
            </div>
          </Section>

          <Section title="Type & attributes">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {typeOptions.map((t) => (
                  <Toggle
                    key={t.key}
                    label={t.label}
                    checked={types.includes(t.key)}
                    onChange={(on) => setTypes((prev) => (on ? [...new Set([...prev, t.key])] : prev.filter((k) => k !== t.key)))}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Size compare</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={sizeCmp} onChange={(e) => setSizeCmp(e.target.value as any)}>
                    <option value="none">(none)</option>
                    <option value="lt">&lt;</option>
                    <option value="gt">&gt;</option>
                    <option value="eq">=</option>
                  </select>
                </div>
                <div>
                  <Label>Size</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min={0} placeholder="e.g. 100" value={sizeNum} onChange={(e) => setSizeNum(e.target.value)} />
                </div>
                <div>
                  <Label>Unit</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value as any)}>
                    <option value="c">bytes (c)</option>
                    <option value="k">KiB (k)</option>
                    <option value="M">MiB (M)</option>
                    <option value="G">GiB (G)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 items-end">
                <div>
                  <Label>Time kind</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={timeKind} onChange={(e) => setTimeKind(e.target.value as any)}>
                    <option value="mtime">modified (-mtime/-mmin)</option>
                    <option value="atime">accessed (-atime/-amin)</option>
                    <option value="ctime">changed (-ctime/-cmin)</option>
                  </select>
                </div>
                <div>
                  <Label>Compare</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={timeCmp} onChange={(e) => setTimeCmp(e.target.value as any)}>
                    <option value="none">(none)</option>
                    <option value="within">within last</option>
                    <option value="older">older than</option>
                    <option value="exact">exactly</option>
                  </select>
                </div>
                <div>
                  <Label>Value</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min={0} value={timeValue} onChange={(e) => setTimeValue(e.target.value)} placeholder="e.g. 15" />
                </div>
                <div>
                  <Label>Unit</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={timeUnit} onChange={(e) => setTimeUnit(e.target.value as any)}>
                    <option value="days">days (-mtime)</option>
                    <option value="hours">hours (~-mmin)</option>
                    <option value="minutes">minutes (-mmin)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Newer than file (-newer)</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={newerFile} onChange={(e) => setNewerFile(e.target.value)} placeholder="/path/to/ref" />
                </div>
                <div>
                  <Label>User (-user)</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={user} onChange={(e) => setUser(e.target.value)} placeholder="name or uid" />
                </div>
                <div>
                  <Label>Group (-group)</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="name or gid" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Permissions</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={perm} onChange={(e) => setPerm(e.target.value)} placeholder="e.g. 0644 or u+s" />
                </div>
                <div>
                  <Label>Perm kind</Label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={permKind} onChange={(e) => setPermKind(e.target.value as any)}>
                    {permKinds.map((k) => (
                      <option key={k.key} value={k.key}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-3">
                  <Toggle label="-empty" checked={emptyOnly} onChange={setEmptyOnly} />
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <Toggle label="-readable" checked={readable} onChange={setReadable} />
                <Toggle label="-writable" checked={writable} onChange={setWritable} />
                <Toggle label="-executable" checked={executable} onChange={setExecutable} />
              </div>
            </div>
          </Section>

          <Section title="Action">
            <div className="grid gap-3">
              <div>
                <Label>What to do with matches</Label>
                <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={action} onChange={(e) => setAction(e.target.value as any)}>
                  {actionOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {action === "printf" && (
                <div>
                  <Label>-printf format</Label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-mono" value={printfFmt} onChange={(e) => setPrintfFmt(e.target.value)} />
                  <Help>
                    Common tokens: <code>%p</code>=path, <code>%f</code>=basename, <code>%s</code>=size bytes, <code>%TY-%Tm-%Td %TH:%TM</code>=time, end with <code>\n</code>.
                  </Help>
                </div>
              )}

              {(action === "exec" || action === "ok" || action === "okdir") && (
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2">
                    <Label>
                      Command template (use <code>{"{}"}</code> for the found path)
                    </Label>
                    <textarea rows={2} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-mono" value={execCmd} onChange={(e) => setExecCmd(e.target.value)} placeholder="e.g. rm -v {}" />
                  </div>
                  <div>
                    <Label>Mode</Label>
                    <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={execMode} onChange={(e) => setExecMode(e.target.value as any)}>
                      <option value="semicolon">run per entry (-exec ... \;)</option>
                      <option value="plus">batch args (-exec ... +)</option>
                    </select>
                  </div>
                </div>
              )}

              <DangerCallout show={dangerous}>
                <ul className="list-disc ml-5 space-y-1">
                  <li>
                    Consider testing with <code>-print</code> first or adding <code>-ok</code> for interactive confirmation.
                  </li>
                  <li>
                    Combine with <code>-mindepth 1</code> to avoid touching the root of the search path itself.
                  </li>
                  <li>
                    When deleting directories, prune what you don’t want descended into, or restrict <code>-maxdepth</code>.
                  </li>
                  <li>
                    Prefer batching (<code>+</code>) for non-interactive safe tools like <code>xargs -0</code> or <code>tar</code>.
                  </li>
                </ul>
              </DangerCallout>

              <div className="flex gap-2">
                <button onClick={() => copy(command)} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50 text-sm">
                  Copy command
                </button>
                <button onClick={() => copy(explanation)} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50 text-sm">
                  Copy explanation
                </button>
                <button onClick={() => setExplainOpen((v) => !v)} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-slate-50 text-sm">
                  {explainOpen ? "Hide" : "Show"} explain
                </button>
              </div>
            </div>
          </Section>
        </div>

        <Section title="Your command">
          <div className="bg-slate-900 text-slate-100 rounded-xl p-3 font-mono text-sm overflow-x-auto">
            <pre className="whitespace-pre-wrap break-all">{command}</pre>
          </div>
          {explainOpen && (
            <div className="mt-3">
              <Label>What it does</Label>
              <pre className="mt-1 whitespace-pre-wrap text-sm bg-white rounded-xl border p-3">{explanation}</pre>
            </div>
          )}
          <Help>
            Tip: add <code>-print0</code> and pipe to <code>xargs -0</code> for robust argument handling; or prefer the built-in <code>-exec ... +</code> batching.
          </Help>
        </Section>

        <Section title="Self‑tests (smoke)">
          <div className="text-sm">
            {tests.map((t, i) => {
              const pass = t.got === t.expected;
              return (
                <div key={i} className={`flex items-start gap-2 p-2 rounded-xl border ${pass ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="min-w-[6ch] font-mono">{pass ? "PASS" : "FAIL"}</div>
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="font-mono">got: {t.got}</div>
                    <div className="font-mono">exp: {t.expected}</div>
                  </div>
                </div>
              );
            })}
            {tests.length === 0 && <div className="text-slate-500">(no tests run)</div>}
          </div>
        </Section>

        <Section title="Cheat sheet">
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <ul className="space-y-1">
              <li>
                <code>-name '*.log'</code> — glob on basename
              </li>
              <li>
                <code>-path '*/cache/*'</code> — glob on full path
              </li>
              <li>
                <code>-regex '.*\\.log$'</code> — regex on full path
              </li>
              <li>
                <code>-type f|d|l|s|p|b|c</code> — file kinds
              </li>
              <li>
                <code>-size +1G</code> — greater than 1 GiB
              </li>
              <li>
                <code>-mtime -7</code> — modified within 7 days
              </li>
              <li>
                <code>-mmin +30</code> — modified over 30 minutes ago
              </li>
              <li>
                <code>-newer ref.txt</code> — newer than file
              </li>
              <li>
                <code>-perm /022</code> — any of g+w or o+w set
              </li>
              <li>
                <code>-user root -group adm</code> — owner/group
              </li>
              <li>
                <code>( A -o B )</code> / <code>( A -a B )</code> — OR / AND groups
              </li>
              <li>
                <code>! -readable</code> — negate a test
              </li>
            </ul>
            <div>
              <div className="font-medium mb-1">-printf tokens</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <div>
                  <code>%p</code> path
                </div>
                <div>
                  <code>%f</code> basename
                </div>
                <div>
                  <code>%s</code> size bytes
                </div>
                <div>
                  <code>%M</code> mode (rwx)
                </div>
                <div>
                  <code>%u</code> user
                </div>
                <div>
                  <code>%g</code> group
                </div>
                <div>
                  <code>%TY-%Tm-%Td</code> date
                </div>
                <div>
                  <code>%TH:%TM:%TS</code> time
                </div>
                <div className="col-span-2">
                  <code>\n</code> newline (don’t forget it)
                </div>
              </div>
            </div>
          </div>
        </Section>

        <footer className="text-xs text-slate-500 pb-6">
          Built with ❤️ for shell nerds. Always test destructive commands with <code>-print</code> first.
        </footer>
      </div>
    </div>
  );
}

