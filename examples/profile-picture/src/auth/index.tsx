import "server-only";

import * as Crypto from "node:crypto";
import { cache } from "react";
import { redirect } from "next/navigation";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Github from "next-auth/providers/github";
import { z } from "zod";

import { db } from "../db/client";
import { Account, User } from "../db/schema";
import { authConfig } from "./config";

async function hash(password: string) {
  return new Promise<string>((resolve, reject) => {
    const salt = Crypto.randomBytes(16).toString("hex");
    Crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        console.error("Error hashing password", err);
        reject(err);
      }
      resolve(`${salt}.${derivedKey.toString("hex")}`);
    });
  });
}

async function compare(password: string, hash: string) {
  return new Promise<boolean>((resolve, reject) => {
    const [salt, hashKey] = hash.split(".");
    Crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        console.error("Error comparing password", err);
        reject(err);
      }
      resolve(Crypto.timingSafeEqual(Buffer.from(hashKey, "hex"), derivedKey));
    });
  });
}

const {
  auth: uncachedAuth,
  handlers: { GET, POST },
  signIn,
  signOut,
  unstable_update,
} = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: User,
    accountsTable: Account,
  }),
  providers: [
    Github,
    Credentials({
      name: "Credentials",
      async authorize(c) {
        const credentials = z
          .object({
            email: z.string().email(),
            password: z.string().min(6).max(32),
          })
          .safeParse(c);
        if (!credentials.success) return null;

        const user = await db.query.User.findFirst({
          where: (fields, ops) =>
            ops.sql`${fields.email} = ${credentials.data.email} COLLATE NOCASE`,
        });
        if (user) {
          if (!user.hashedPassword) {
            console.debug(
              `OAuth User ${user.id} attempted signin with password`,
            );
            return null;
          }
          const pwMatch = await compare(
            credentials.data.password,
            user.hashedPassword,
          );
          if (!pwMatch) {
            console.debug(`User ${user.id} attempted login with bad password`);
            return null;
          }
          return { id: user.id, name: user.name };
        }

        // Auto-signup new users - whatever...
        const name = credentials.data.email.split("@")[0];
        console.debug(
          `Auto-signup new user ${credentials.data.email} as ${name}`,
        );
        const [newUser] = await db
          .insert(User)
          .values({
            email: credentials.data.email,
            name,
            hashedPassword: await hash(credentials.data.password),
          })
          .returning();
        return { id: newUser.id, name: newUser.name };
      },
    }),
  ],
});

export { signIn, signOut, GET, POST, unstable_update };

/**
 * Deduped function to get the session for the current user.
 */
export const auth = cache(uncachedAuth);

/**
 * Deduped function to get the current user.
 * Will redirect to the login page if not signed in.
 */
export const currentUser = cache(async () => {
  const sesh = await auth();
  if (!sesh?.user) redirect(authConfig.pages.signIn);
  return sesh.user;
});

/**
 * Control component to conditionally render a child component
 * for signed in users.
 */
export async function SignedIn(props: {
  children:
    | React.ReactNode
    | ((props: { user: Session["user"] }) => React.ReactNode);
}) {
  const sesh = await auth();
  return sesh?.user ? (
    <>
      {typeof props.children === "function"
        ? props.children({ user: sesh.user })
        : props.children}
    </>
  ) : null;
}

/**
 * Control component to conditionally render a child component
 * for signed out users.
 */
export async function SignedOut(props: { children: React.ReactNode }) {
  const sesh = await auth();
  return sesh?.user ? null : <>{props.children}</>;
}
