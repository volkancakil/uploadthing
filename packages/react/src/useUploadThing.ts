import { useRef, useState } from "react";

import type {
  EndpointMetadata,
  ExpandedRouteConfig,
} from "@uploadthing/shared";
import {
  INTERNAL_DO_NOT_USE__fatalClientError,
  resolveMaybeUrlArg,
  semverLite,
  UploadAbortedError,
  UploadThingError,
} from "@uploadthing/shared";
import {
  genUploader,
  version as uploadthingClientVersion,
} from "uploadthing/client";
import type {
  FileRouter,
  inferEndpointInput,
  inferErrorShape,
} from "uploadthing/types";

import { peerDependencies } from "../package.json";
import type { GenerateTypedHelpersOptions, UseUploadthingProps } from "./types";
import { useEvent } from "./utils/useEvent";
import useFetch from "./utils/useFetch";

declare const globalThis: {
  __UPLOADTHING?: EndpointMetadata;
};

const useRouteConfig = (
  url: URL,
  endpoint: string,
): ExpandedRouteConfig | undefined => {
  const maybeServerData = globalThis.__UPLOADTHING;
  const { data } = useFetch<EndpointMetadata>(
    // Don't fetch if we already have the data
    maybeServerData ? undefined : url.href,
  );
  return (maybeServerData ?? data)?.find((x) => x.slug === endpoint)?.config;
};

export const INTERNAL_uploadthingHookGen = <
  TRouter extends FileRouter,
>(initOpts: {
  /**
   * URL to the UploadThing API endpoint
   * @example URL { http://localhost:3000/api/uploadthing }
   * @example URL { https://www.example.com/api/uploadthing }
   */
  url: URL;
}) => {
  if (!semverLite(peerDependencies.uploadthing, uploadthingClientVersion)) {
    console.error(
      `!!!WARNING::: @uploadthing/react requires "uploadthing@${peerDependencies.uploadthing}", but version "${uploadthingClientVersion}" is installed`,
    );
  }
  const uploadFiles = genUploader<TRouter>({
    url: initOpts.url,
    package: "@uploadthing/react",
  });

  const useUploadThing = <
    TEndpoint extends keyof TRouter,
    TSkipPolling extends boolean = false,
  >(
    endpoint: TEndpoint,
    opts?: UseUploadthingProps<TRouter, TEndpoint, TSkipPolling>,
  ) => {
    const [isUploading, setUploading] = useState(false);
    const uploadProgress = useRef(0);
    const fileProgress = useRef<Map<string, number>>(new Map());

    type InferredInput = inferEndpointInput<TRouter[typeof endpoint]>;
    type FuncInput = undefined extends InferredInput
      ? [files: File[], input?: undefined]
      : [files: File[], input: InferredInput];

    const startUpload = useEvent(async (...args: FuncInput) => {
      const files = (await opts?.onBeforeUploadBegin?.(args[0])) ?? args[0];
      const input = args[1];

      setUploading(true);
      files.forEach((f) => fileProgress.current.set(f.name, 0));
      opts?.onUploadProgress?.(0);
      try {
        const res = await uploadFiles<TEndpoint, TSkipPolling>(endpoint, {
          signal: opts?.signal,
          headers: opts?.headers,
          files,
          skipPolling: opts?.skipPolling,
          onUploadProgress: (progress) => {
            if (!opts?.onUploadProgress) return;
            fileProgress.current.set(progress.file, progress.progress);
            let sum = 0;
            fileProgress.current.forEach((p) => {
              sum += p;
            });
            const averageProgress =
              Math.floor(sum / fileProgress.current.size / 10) * 10;
            if (averageProgress !== uploadProgress.current) {
              opts?.onUploadProgress?.(averageProgress);
              uploadProgress.current = averageProgress;
            }
          },
          onUploadBegin({ file }) {
            if (!opts?.onUploadBegin) return;

            opts.onUploadBegin(file);
          },
          // @ts-expect-error - input may not be defined on the type
          input,
        });

        await opts?.onClientUploadComplete?.(res);
        return res;
      } catch (e) {
        /**
         * This is the only way to introduce this as a non-breaking change
         * TODO: Consider refactoring API in the next major version
         */
        if (e instanceof UploadAbortedError) throw e;

        let error: UploadThingError<inferErrorShape<TRouter>>;
        if (e instanceof UploadThingError) {
          error = e as UploadThingError<inferErrorShape<TRouter>>;
        } else {
          error = INTERNAL_DO_NOT_USE__fatalClientError(e as Error);
          console.error(
            "Something went wrong. Please contact UploadThing and provide the following cause:",
            error.cause instanceof Error ? error.cause.toString() : error.cause,
          );
        }
        await opts?.onUploadError?.(error);
      } finally {
        setUploading(false);
        fileProgress.current = new Map();
        uploadProgress.current = 0;
      }
    });

    const routeConfig = useRouteConfig(initOpts.url, endpoint as string);

    return {
      startUpload,
      isUploading,
      routeConfig,

      /**
       * @deprecated Use `routeConfig` instead
       */
      permittedFileInfo: routeConfig
        ? { slug: endpoint, config: routeConfig }
        : undefined,
    } as const;
  };

  return useUploadThing;
};

export const generateReactHelpers = <TRouter extends FileRouter>(
  initOpts?: GenerateTypedHelpersOptions,
) => {
  const url = resolveMaybeUrlArg(initOpts?.url);

  const getRouteConfig = (endpoint: keyof TRouter) => {
    const maybeServerData = globalThis.__UPLOADTHING;
    const config = maybeServerData?.find((x) => x.slug === endpoint)?.config;
    if (!config) {
      throw new Error(
        `No config found for endpoint "${endpoint.toString()}". Please make sure to use the NextSSRPlugin in your Next.js app.`,
      );
    }
    return config;
  };

  return {
    useUploadThing: INTERNAL_uploadthingHookGen<TRouter>({ url }),
    uploadFiles: genUploader<TRouter>({
      url,
      package: "@uploadthing/react",
    }),

    /**
     * Get the config for a given endpoint outside of React context.
     * @remarks Can only be used if the NextSSRPlugin is used in the app.
     */
    getRouteConfig,
  } as const;
};
