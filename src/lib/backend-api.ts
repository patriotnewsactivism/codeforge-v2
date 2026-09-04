type ApiReference = {
  readonly __rpcName: string;
  readonly [key: string]: ApiReference;
};

function reference(path: string[]): ApiReference {
  const target = {
    __rpcName: path.join("."),
  };

  return new Proxy(target as ApiReference, {
    get(current, property) {
      if (property === "__rpcName") {
        return current.__rpcName;
      }

      if (property === Symbol.toPrimitive) {
        return () => current.__rpcName;
      }

      if (property === "toString") {
        return () => current.__rpcName;
      }

      return reference([...path, String(property)]);
    },
  });
}

export const api = reference([]);

export function getRpcName(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "__rpcName" in value &&
    typeof (value as { __rpcName?: unknown }).__rpcName === "string"
  ) {
    return (value as { __rpcName: string }).__rpcName;
  }

  if (typeof value === "string") {
    return value;
  }

  throw new Error("Invalid backend API reference");
}
