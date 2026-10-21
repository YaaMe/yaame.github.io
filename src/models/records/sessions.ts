/**
 * Only what is used.
 *
 * GitHub also hands back a real name and an avatar. Neither is shown, and
 * keeping a person's legal name because it arrived is collecting it for no
 * reason. The avatar costs nothing to drop either: its address is derivable
 * from the id.
 */
export type Session = {
  userId: number;
  login: string;
  createdAt: string;
  expiresAt: string;
};

export type Role = "owner" | "allowed" | "guest";
export type ActiveSession = Session & { role: Role };
