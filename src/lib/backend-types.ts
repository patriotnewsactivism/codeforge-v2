export type Id<_TableName extends string> = string;

export type Doc<_TableName extends string> = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};
