export type NativeBrowserPaneStatus = "experimental" | "unavailable";

export type NativeBrowserPaneDescriptor = {
  kind: "native-browser";
  status: NativeBrowserPaneStatus;
  url: string;
};

