/**
 * The mock COLA service — the data layer the console reads from.
 *
 * It exposes the queue (list/get) and records the agent's disposition for an
 * application. The point of putting this behind a `ColaSource` interface is the
 * production seam: the prototype serves the committed sample, but swapping in
 * `ColaCloudSource` (a real REST adapter) is a one-line change and nothing in the
 * app moves. That keeps the demo self-contained and stateless per the brief while
 * showing exactly how the live TTB registry would plug in.
 *
 * Decisions are held in memory by design — the brief asks for no persistence, so
 * a real review trail (database, audit log) is explicitly out of scope. On
 * serverless this state is per-instance and resets on cold start; production would
 * persist it behind this same API.
 */
import { ColaApplication, MOCK_APPLICATIONS } from "./mock-cola";

/** Where queue records come from. Async so a real API adapter fits the shape. */
export interface ColaSource {
  list(): Promise<ColaApplication[]>;
  get(id: string): Promise<ColaApplication | undefined>;
}

/** Prototype source: the committed sample seeded from the public COLA registry. */
class SeededColaSource implements ColaSource {
  async list() {
    return MOCK_APPLICATIONS;
  }
  async get(id: string) {
    return MOCK_APPLICATIONS.find((a) => a.id === id);
  }
}

/**
 * Production source — NOT wired in the prototype. Documents the integration path:
 * the same queue, fetched live from the COLA Cloud REST API. Selecting it would
 * be the only change needed (`const source = new ColaCloudSource(...)`).
 */
export class ColaCloudSource implements ColaSource {
  constructor(
    private readonly apiKey = process.env.COLA_API_KEY ?? "",
    private readonly base = "https://api.colacloud.us",
  ) {}

  private async call(path: string): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`COLA Cloud ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async list(): Promise<ColaApplication[]> {
    // Would page `/colas?status=pending` (via this.call) and map each record.
    throw new Error("ColaCloudSource.list is not enabled in the prototype (see cola-store.ts).");
  }
  async get(id: string): Promise<ColaApplication | undefined> {
    // Would call `/colas/${id}` (via this.call) and map the record.
    throw new Error(`ColaCloudSource.get(${id}) is not enabled in the prototype (see cola-store.ts).`);
  }
}

const source: ColaSource = new SeededColaSource();

/** List every application in the review queue. */
export function listApplications(): Promise<ColaApplication[]> {
  return source.list();
}

/** Fetch one application by its COLA id, or undefined if there's no match. */
export function getApplication(id: string): Promise<ColaApplication | undefined> {
  return source.get(id);
}

// Agent decisions live client-side (see src/lib/decisions.ts) — a right-sized
// choice for a single-agent prototype. Production would persist them server-side
// behind an audit log, against this same application data.
