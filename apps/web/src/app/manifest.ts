import type { MetadataRoute } from "next";

import { PRODUCT_NAME } from "@/lib/brand";
import { publicPage } from "@/lib/seo";

/**
 * https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
 *
 * `display: "browser"` rather than `standalone`: the app is desktop-only by decision
 * (§2.13), so advertising it as installable would invite exactly the phone install that
 * leads to the desktop-required page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: publicPage("/").description,
    start_url: "/",
    display: "browser",
    background_color: "#fbfbfd",
    theme_color: "#5846d2",
    lang: "en",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
