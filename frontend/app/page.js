export const dynamic = "force-dynamic";

export default function Page() {
	return (
		<iframe
			src={`/pdf?t=${Date.now()}`}
			style={{
				position: "fixed",
				inset: 0,
				width: "100%",
				height: "100%",
				border: "none",
			}}
		/>
	);
}
