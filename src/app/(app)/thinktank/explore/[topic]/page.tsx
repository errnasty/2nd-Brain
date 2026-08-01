import { requireUser } from "@/lib/auth";
import { topicProgress } from "@/lib/thinktank/concepts";
import { DiscoverView } from "@/components/thinktank/discover-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ topic: string }>;

/** Discover: the entry point to exploring a topic. */
export default async function ExploreTopicPage({ params }: { params: Params }) {
  const { topic: raw } = await params;
  const { user } = await requireUser();
  const topic = decodeURIComponent(raw).trim();
  const progress = await topicProgress(user.id, topic);
  return <DiscoverView topic={topic} progress={progress} />;
}
