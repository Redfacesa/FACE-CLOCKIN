import { ClockCamera } from "@/components/clock-camera";
import { listFacePeople } from "@/lib/face/memory";
import { DomainError } from "@/lib/domain/model";

export default async function ClockPage() {
  let people: Awaited<ReturnType<typeof listFacePeople>> = [];
  let error = "";
  try {
    people = await listFacePeople();
  } catch (caught) {
    error = caught instanceof DomainError ? caught.message : "The employee list could not be loaded.";
  }

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Face registry</h1>
          <p className="muted">
            A face is converted into a 512-number template, encrypted, and saved on the employee in Redface Pay. The photograph is discarded.
            Clock-in compares a new template with the saved one. It does not look up a picture.
          </p>
        </div>
      </div>
      {error ? <p className="banner bad">{error}</p> : <ClockCamera people={people} />}
    </main>
  );
}
