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
            Capture a face here before the front camera can recognise that person. The photograph is discarded. Only the encrypted template is saved.
          </p>
        </div>
      </div>
      {error ? <p className="banner bad">{error}</p> : <ClockCamera people={people} />}
    </main>
  );
}
