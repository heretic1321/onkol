async function pinStatusMessage(message, logger = console) {
  if (typeof message?.pin !== "function" || message.pinned) return true;
  try {
    await message.pin();
    return true;
  } catch (err) {
    logger.error(`Status card pin unavailable: ${err.message || err}`);
    return false;
  }
}

module.exports = { pinStatusMessage };
