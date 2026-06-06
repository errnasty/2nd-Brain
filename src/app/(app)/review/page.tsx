import { redirect } from "next/navigation";

// Review now lives inside the Study hub.
export default function ReviewRedirect() {
  redirect("/study?tab=review");
}
