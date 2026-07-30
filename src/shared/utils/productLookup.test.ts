import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestError } from "../errors/AppError.js";
import {
  findProductByBrandAndLabel,
  findProductByBrandLabelOverlap,
  findProductByLabelOverlap,
  indexProductsByBrandAndLabel,
} from "./productLookup.js";

type Product = {
  name: string;
  secondaryName?: string;
  brand: string;
};

type BrandProduct = {
  name: string;
  secondaryName?: string;
  brandId: string;
};

test("finds products by primary or secondary label within a brand", () => {
  const products: Product[] = [
    { name: "Paper Bowl", secondaryName: "PB 500", brand: "EcoServe" },
    { name: "Paper Cup", brand: "EcoServe" },
  ];

  assert.equal(
    findProductByBrandAndLabel(products, "ecoserve", "pb 500", (p) => p.brand),
    products[0]
  );
  assert.equal(
    findProductByBrandAndLabel(products, "EcoServe", "paper cup", (p) => p.brand),
    products[1]
  );
});

test("rejects ambiguous primary and secondary product labels", () => {
  const products: Product[] = [
    { name: "Paper Bowl", secondaryName: "Lunch Box", brand: "EcoServe" },
    { name: "Lunch Box", brand: "EcoServe" },
  ];

  assert.throws(
    () => indexProductsByBrandAndLabel(products, (p) => p.brand),
    BadRequestError
  );
});

test("overlap lookup matches a single product within the brand", () => {
  const products: BrandProduct[] = [
    { name: "Paper Bowl", secondaryName: "PB 500", brandId: "b1" },
    { name: "Paper Cup", brandId: "b1" },
    { name: "Paper Bowl", brandId: "b2" },
  ];

  const match = findProductByBrandLabelOverlap(
    products,
    "b1",
    "Paper Bowl",
    undefined,
    (p) => p.brandId
  );
  assert.equal(match, products[0]);
});

test("overlap lookup returns undefined when nothing matches", () => {
  const products: BrandProduct[] = [{ name: "Paper Cup", brandId: "b1" }];
  const match = findProductByBrandLabelOverlap(
    products,
    "b1",
    "Plastic Fork",
    undefined,
    (p) => p.brandId
  );
  assert.equal(match, undefined);
});

test("overlap lookup matches ignoring extra spaces and case", () => {
  const products: BrandProduct[] = [
    { name: "11 inch plate", brandId: "b1" },
  ];

  const match = findProductByBrandLabelOverlap(
    products,
    "b1",
    "11  Inch   Plate",
    undefined,
    (p) => p.brandId
  );
  assert.equal(match, products[0]);
});

test("label overlap matches sales-register names ignoring extra spaces", () => {
  const products = [
    { name: "ECOINFINITY 11 INCH 4 CP ROUND PLATE (800pc)" },
  ];
  const match = findProductByLabelOverlap(
    products,
    "ECOINFINITY  11 INCH 4 CP ROUND PLATE (800pc)"
  );
  assert.equal(match, products[0]);
});

test("label overlap ignores inactive products so deactivated duplicates do not block", () => {
  const products = [
    {
      name: 'EI 11"4 Cp Round Plate (800pc)',
      isActive: false,
    },
    {
      name: 'EI 11"4 Cp Round Plate (800pc)',
      secondaryName: "ECOINFINITY 11 INCH 4 CP ROUND PLATE BROWN",
      isActive: true,
    },
  ];

  assert.equal(
    findProductByLabelOverlap(products, 'EI 11"4 CpRoundPlate (800pc)'),
    products[1]
  );
});

test("label overlap still throws when multiple active products match", () => {
  const products = [
    { name: 'EI 11"4 Cp Round Plate (800pc)', isActive: true },
    {
      name: "Other",
      secondaryName: 'EI 11"4 Cp Round Plate (800pc)',
      isActive: true,
    },
  ];

  assert.throws(
    () => findProductByLabelOverlap(products, 'EI 11"4 CpRoundPlate (800pc)'),
    BadRequestError
  );
});

test("brand overlap matches stripped import name against secondary name", () => {
  const products: BrandProduct[] = [
    {
      name: 'El 11"4 Cp Round Plate (800pc)',
      secondaryName: "ECOINFINITY 11 INCH 4 CP ROUND PLATE (800pc)",
      brandId: "b1",
    },
  ];

  assert.equal(
    findProductByBrandLabelOverlap(
      products,
      "b1",
      "ECOINFINITY  11 INCH 4 CP ROUND PLATE (800pc)",
      undefined,
      (p) => p.brandId
    ),
    products[0]
  );
});

test("overlap lookup throws when an import row matches multiple products", () => {
  const products: BrandProduct[] = [
    { name: "Paper Bowl", brandId: "b1" },
    { name: "Large Bowl", secondaryName: "Paper Bowl", brandId: "b1" },
  ];

  assert.throws(
    () =>
      findProductByBrandLabelOverlap(
        products,
        "b1",
        "Paper Bowl",
        undefined,
        (p) => p.brandId
      ),
    BadRequestError
  );
});
