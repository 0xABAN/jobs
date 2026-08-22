import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
	const file = await readFile(join(process.cwd(), "..", "editions", "Adam_Torres_Encarnacion_Resume.pdf"));
	return new Response(file, {
		headers: {
			"Content-Type": "application/pdf",
			"Cache-Control": "no-store",
		},
	});
}
