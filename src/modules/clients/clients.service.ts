import { Types } from "mongoose";
import { Client } from "../../models/Client.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors/AppError.js";
import type { CreateClientInput, UpdateClientInput } from "./clients.validation.js";

function exactNameRegex(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

export function toPublicClient(doc: {
  _id: Types.ObjectId;
  name: string;
  secondaryName?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(doc._id),
    name: doc.name,
    secondaryName: doc.secondaryName,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listClients(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  const clients = await Client.find(filter).sort({ name: 1 }).lean();
  return clients.map((client) => toPublicClient(client));
}

export async function getClientById(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Client not found");
  }
  const client = await Client.findById(id).lean();
  if (!client) {
    throw new NotFoundError("Client not found");
  }
  return toPublicClient(client);
}

export async function createClient(input: CreateClientInput) {
  const name = input.name.trim();
  const existing = await Client.findOne({ name: exactNameRegex(name) });
  if (existing) {
    throw new BadRequestError("A client with this primary name already exists");
  }

  const client = await Client.create({
    name,
    secondaryName: input.secondaryName,
    isActive: input.isActive ?? true,
  });

  return toPublicClient(client.toObject());
}

export async function updateClient(id: string, input: UpdateClientInput) {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundError("Client not found");
  }

  const client = await Client.findById(id);
  if (!client) {
    throw new NotFoundError("Client not found");
  }

  if (input.name !== undefined) {
    const nextName = input.name.trim();
    if (nextName !== client.name) {
      const nameTaken = await Client.findOne({
        name: exactNameRegex(nextName),
        _id: { $ne: id },
      });
      if (nameTaken) {
        throw new BadRequestError("A client with this primary name already exists");
      }
      client.name = nextName;
    }
  }

  if (input.secondaryName !== undefined) {
    const value = input.secondaryName;
    client.secondaryName =
      typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  if (input.isActive !== undefined) {
    client.isActive = input.isActive;
  }

  await client.save();
  return toPublicClient(client.toObject());
}
