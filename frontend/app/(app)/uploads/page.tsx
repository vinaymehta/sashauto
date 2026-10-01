import { redirect } from "next/navigation";

// Upload History was removed from the UI; old links land on Upload / Detection.
export default function UploadsPage() {
  redirect("/detect");
}
