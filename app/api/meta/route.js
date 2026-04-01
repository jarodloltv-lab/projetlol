import { NextResponse } from "next/server";
import { getMetaSnapshot } from "../../../lib/server/riot-meta";

export async function GET() {
  try {
    const snapshot = await getMetaSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        patch: "unknown",
        source: "error",
        generatedAt: new Date().toISOString(),
        message: "Impossible de charger la meta live pour le moment.",
        detail: error.message,
        topChampions: [],
        byChampion: {}
      },
      { status: 500 }
    );
  }
}
