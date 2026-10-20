// Push hook for challenge moments. Step 4 sends these through APNs (quiet hours, 3 a day);
// until then they're logged. Tests read `sent` to check what would go out.
export const sent = [];

/** `{ kind, challengeId, to: memberId[], from?: memberId, data? }`. Never throws. */
export async function notify(message) {
  sent.push(message);
}

export function _resetSent() {
  sent.length = 0;
}
