export async function finalizePickerSave({
  persist,
  apply,
  close,
  syncLearning,
  onSyncError = () => {},
}) {
  await persist();
  try {
    apply();
  } finally {
    // Closing the picker is part of the user action. Learning sync is
    // background maintenance and must never keep its overlays on screen.
    close();
  }
  void Promise.resolve()
    .then(() => syncLearning?.())
    .catch(onSyncError);
}
