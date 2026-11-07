import { NextResponse } from "next/server";

export const runtime = "nodejs";

const apiKey =
  process.env.AI_API_KEY ?? process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY;
const baseUrl = (process.env.AI_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
const model = process.env.AI_MODEL ?? "llama-3.3-70b-versatile";

interface Passage {
  source: string;
  label: string;
  text: string;
}

interface Body {
  content?: string;
  brandKitName?: string;
  passages?: Passage[];
  intentSummary?: string;
}

const SYSTEM_PROMPT = `You are BrandLens, a brand governance reviewer.
You receive brand kit passages and a piece of content.
Return ONLY judgement calls the deterministic rules cannot make: tone drift, claims whose support is weak, or meaning-changing wording.
Hard rules:
- Every finding MUST include a "citation" that exactly matches the "label" of one supplied passage, and "sourcePassage" copied verbatim from that passage's "text".
- If no passage supports a concern, omit the finding entirely. Never invent a citation.
- Maximum 4 findings. If the content is on-brand, return an empty array.
Respond with JSON: {"findings":[{"type":"terminology|claim|colour|contrast|alt_text|logo|custom","severity":"low|medium|high|critical","message":"...","citation":"...","sourcePassage":"...","suggestion":"...","confidence":0.0-1.0}]}`;

export async function POST(request: Request) {
  if (!apiKey) {
    // 200 with `configured: false` keeps the client console clean; the pipeline
    // reports the AI pass as skipped and deterministic rules still run.
    return NextResponse.json({
      configured: false,
      findings: [],
      hint: "Set AI_API_KEY (or GROQ_API_KEY) to enable the judgement pass.",
    });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const content = (body.content ?? "").slice(0, 8000);
  const passages = (body.passages ?? []).slice(0, 40);
  if (!content.trim() || passages.length === 0) {
    return NextResponse.json({ findings: [] });
  }

  const userPrompt = [
    `Brand kit: ${body.brandKitName ?? "Untitled"}`,
    body.intentSummary ? `Creator intent: ${body.intentSummary}` : "",
    "",
    "BRAND KIT PASSAGES:",
    ...passages.map((p, i) => `${i + 1}. [${p.source}] label="${p.label}" text="${p.text}"`),
    "",
    "CONTENT TO REVIEW:",
    content,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: `AI provider error (${response.status}).`, detail: detail.slice(0, 400) },
        { status: 502 }
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content ?? "{}";

    let parsed: { findings?: unknown } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ findings: [] });
    }

    return NextResponse.json({
      findings: Array.isArray(parsed.findings) ? parsed.findings.slice(0, 4) : [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "AI provider unreachable.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
