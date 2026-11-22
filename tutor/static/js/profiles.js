// Synthetic demo learners for the offline slice.
// These are fictional aliases only: they are synthetic and need no data entry.
export const SAMPLE_PROFILES = Object.freeze([
  Object.freeze({ id: "learner-a", alias: "learner-a" }),
  Object.freeze({ id: "learner-b", alias: "learner-b" }),
  Object.freeze({ id: "learner-c", alias: "learner-c" }),
]);

export function findSampleProfile(id) {
  return SAMPLE_PROFILES.find((profile) => profile.id === id) ?? null;
}
