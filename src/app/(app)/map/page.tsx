import { KnowledgeMap } from "@/components/map/knowledge-map";
import { requireUser } from "@/lib/auth";

export default async function MapPage() {
  await requireUser();
  return <KnowledgeMap />;
}
