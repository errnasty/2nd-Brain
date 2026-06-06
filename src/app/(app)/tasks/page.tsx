import { redirect } from "next/navigation";

// Tasks now live inside the Study hub.
export default function TasksRedirect() {
  redirect("/study?tab=tasks");
}
