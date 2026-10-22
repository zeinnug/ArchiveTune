interface ArchiveTuneConfig {
  baseUrl: string;
  token: string;
}

interface Window {
  archiveTune: {
    getConfig: () => Promise<ArchiveTuneConfig>;
  };
}
