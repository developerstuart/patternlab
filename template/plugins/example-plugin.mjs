export default {
  afterBuild(payload) {
    console.log('[template-plugin] build complete:', payload.buildMode);
    return payload;
  },
};
