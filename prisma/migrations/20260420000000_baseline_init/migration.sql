-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "compliance_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "description" TEXT,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "obligationTemplateIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_compliance_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "building_compliance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "storageMode" TEXT NOT NULL DEFAULT 'pooled',
    "defaultUiLocale" TEXT NOT NULL DEFAULT 'en',
    "defaultContentLocale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "compliance" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'watch',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT,
    "slug" TEXT NOT NULL,
    "buildingCode" TEXT,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "street" TEXT,
    "buildingNumber" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "defaultContentLocale" TEXT NOT NULL DEFAULT 'en',
    "defaultLanguage" TEXT,
    "supportedLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" TEXT NOT NULL DEFAULT 'Commercial',
    "buildingType" TEXT,
    "primaryUse" TEXT,
    "secondaryUses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "complexityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yearBuilt" INTEGER,
    "floorsAboveGround" INTEGER,
    "floorsBelowGround" INTEGER,
    "floorsCount" INTEGER,
    "unitsCount" INTEGER,
    "entrancesCount" INTEGER,
    "liftsCount" INTEGER,
    "hasParking" BOOLEAN,
    "hasRestaurantsGroundFloor" BOOLEAN,
    "hasRooftopMechanical" BOOLEAN,
    "compliance" INTEGER NOT NULL DEFAULT 0,
    "mandates" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'warning',
    "annualKwh" DOUBLE PRECISION,
    "notes" TEXT,
    "attributes" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "parentAssetId" TEXT,
    "assetTypeId" TEXT,
    "locationId" TEXT,
    "qrBarcode" TEXT,
    "name" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "systemType" TEXT,
    "systemFamily" TEXT,
    "assetLevel" TEXT NOT NULL DEFAULT 'unit',
    "model" TEXT,
    "manufacturer" TEXT,
    "manufacturerPartNo" TEXT,
    "serialNumber" TEXT,
    "installDate" TIMESTAMP(3),
    "commissioningDate" TIMESTAMP(3),
    "warrantyStart" TIMESTAMP(3),
    "warrantyEnd" TIMESTAMP(3),
    "attributes" JSONB,
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'active',
    "conditionState" TEXT NOT NULL DEFAULT 'good',
    "riskCriticality" TEXT NOT NULL DEFAULT 'medium',
    "responsibleDepartment" TEXT,
    "responsibleUserId" TEXT,
    "purchaseCost" DOUBLE PRECISION,
    "replacementCost" DOUBLE PRECISION,
    "contractId" TEXT,
    "slaId" TEXT,
    "haystackTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brickClass" TEXT,
    "brickRelations" JSONB,
    "externalIds" JSONB,
    "ifcGuid" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemFamily" TEXT NOT NULL,
    "isSerialized" BOOLEAN NOT NULL DEFAULT true,
    "schemaKey" TEXT,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_custom_attributes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "attributeKey" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "valueJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_custom_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "title" TEXT,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_media" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "documentId" TEXT,
    "url" TEXT,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_parts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "supplierId" TEXT,
    "unit" TEXT DEFAULT 'pc',
    "reorderPoint" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_spare_parts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "qtyRecommended" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_points" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pointType" TEXT NOT NULL,
    "unit" TEXT,
    "bacnetId" TEXT,
    "opcNodeId" TEXT,
    "haystackRef" TEXT,
    "haystackTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brickClass" TEXT,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "sampleRateS" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sensor_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alarm_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "source" TEXT NOT NULL,
    "bacnetId" TEXT,
    "opcNodeId" TEXT,
    "haystackRef" TEXT,
    "haystackTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brickClass" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastRaisedAt" TIMESTAMP(3),
    "lastClearedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alarm_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT,
    "name" TEXT NOT NULL,
    "basisType" TEXT NOT NULL,
    "recurrenceRule" TEXT NOT NULL,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT true,
    "requiredCertificationKey" TEXT,
    "requiredDocumentTypeKey" TEXT,
    "domain" TEXT,
    "sourceRow" INTEGER,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_bases" (
    "id" TEXT NOT NULL,
    "obligationTemplateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "referenceCode" TEXT,
    "issuingAuthority" TEXT,

    CONSTRAINT "obligation_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicability_rules" (
    "id" TEXT NOT NULL,
    "obligationTemplateId" TEXT NOT NULL,
    "predicate" JSONB NOT NULL,

    CONSTRAINT "applicability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_obligations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "obligationTemplateId" TEXT NOT NULL,
    "complianceStatus" TEXT NOT NULL DEFAULT 'active',
    "criticality" TEXT NOT NULL DEFAULT 'medium',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppm_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "domain" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'building_common',
    "executionMode" TEXT NOT NULL DEFAULT 'in_house',
    "performerOrgId" TEXT,
    "contractId" TEXT,
    "assignedUserId" TEXT,
    "assignedRole" TEXT,
    "approvalChain" JSONB,
    "evidenceRecipients" JSONB,
    "openedByRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "closedByRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slaReminderDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "estimatedAnnualCost" DOUBLE PRECISION,
    "estimatedCostCurrency" TEXT DEFAULT 'ILS',
    "budgetLineId" TEXT,
    "requiresPhotoEvidence" BOOLEAN NOT NULL DEFAULT false,
    "requiresSignoff" BOOLEAN NOT NULL DEFAULT false,
    "retentionYears" INTEGER,
    "requiresApprovalBeforeOrder" BOOLEAN NOT NULL DEFAULT false,
    "frequencyMonths" INTEGER,
    "evidenceDocTypeKey" TEXT,
    "evidenceDocumentTemplateId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppm_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppm_plan_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "obligationTemplateId" TEXT NOT NULL,
    "assignedRole" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "recurrenceRule" TEXT NOT NULL,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastPerformedAt" TIMESTAMP(3),
    "unitId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'building_common',
    "executionMode" TEXT NOT NULL DEFAULT 'in_house',
    "performerOrgId" TEXT,
    "contractId" TEXT,
    "baselineStatus" TEXT NOT NULL DEFAULT 'pending',
    "baselineSetAt" TIMESTAMP(3),
    "baselineSetByUserId" TEXT,
    "baselineEvidenceDocumentId" TEXT,
    "baselineNote" TEXT,
    "assetId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppm_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "planItemId" TEXT,
    "unitId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lifecycleStage" TEXT NOT NULL DEFAULT 'scheduled',
    "executionMode" TEXT,
    "performerOrgId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "result" TEXT,
    "recurrenceRule" TEXT,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "evidenceDocuments" JSONB,
    "blockedReason" TEXT,
    "requiredCertificationKey" TEXT,
    "requiredDocumentTypeKey" TEXT,
    "quoteDocumentId" TEXT,
    "quoteAmount" DOUBLE PRECISION,
    "quoteCurrency" TEXT,
    "quoteReceivedAt" TIMESTAMP(3),
    "approvalRequestId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "serviceReportDocumentId" TEXT,
    "evidenceDistributedTo" JSONB,
    "archivedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppm_execution_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ppm_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "budgetLineId" TEXT,
    "invoiceNo" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "vendorName" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "requesterUserId" TEXT,
    "requesterName" TEXT,
    "threshold" TEXT,
    "hint" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actedByUserId" TEXT,
    "actedAt" TIMESTAMP(3),
    "onBehalfOfUserId" TEXT,
    "delegationId" TEXT,
    "waitingSinceAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "buildingId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "minAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxAmount" DOUBLE PRECISION,
    "stepsJson" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "delegatorUserId" TEXT NOT NULL,
    "delegateUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "buildingId" TEXT,
    "reason" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentTypeKey" TEXT,
    "status" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "virusScanStatus" TEXT DEFAULT 'pending',
    "virusScanAt" TIMESTAMP(3),
    "retentionClass" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "legalHoldReason" TEXT,
    "legalHoldSetAt" TIMESTAMP(3),
    "legalHoldSetBy" TEXT,
    "searchText" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "expiryAlertedAt" TIMESTAMP(3),
    "ownerOrgId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "eventType" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdBy" TEXT DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certifications" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "domain" TEXT,

    CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_certifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "evidenceDocumentId" TEXT,

    CONSTRAINT "user_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "version" TEXT,
    "retentionYears" INTEGER,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "documentTypeKey" TEXT,
    "bodyMarkdown" TEXT,
    "sampleDocumentId" TEXT,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requiresDigitalSignoff" BOOLEAN NOT NULL DEFAULT false,
    "retentionYears" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "recurrenceRule" TEXT,
    "assignedRole" TEXT,
    "estimatedMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_waypoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "locationId" TEXT,
    "unitId" TEXT,
    "legacyZoneId" TEXT,
    "label" TEXT NOT NULL,
    "documentTemplateId" TEXT,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "expectedDurationMinutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_waypoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_instance_answers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "waypointId" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passed" BOOLEAN NOT NULL DEFAULT true,
    "findings" TEXT,
    "photoDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signatureDocumentId" TEXT,

    CONSTRAINT "round_instance_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "maxDelegatableScope" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleKey" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleKey","permission")
);

-- CreateTable
CREATE TABLE "building_role_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "delegatedBy" TEXT,
    "delegatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "building_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_mandates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mandateType" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "contractDocumentId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "seedKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "building_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "rollbackReason" TEXT,
    "createdEntities" JSONB,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawJson" JSONB NOT NULL,
    "mappedJson" JSONB,
    "validationErrors" JSONB,
    "status" TEXT NOT NULL,

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_recommendations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "assetId" TEXT,
    "problemStatement" TEXT NOT NULL,
    "proposedSolution" TEXT NOT NULL,
    "capexEstimate" DOUBLE PRECISION,
    "opexImpact" DOUBLE PRECISION,
    "lifecycleYears" INTEGER,
    "riskReduction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "authorUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'initiation',
    "capexBudgetId" TEXT,
    "recommendationId" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'capex',
    "classificationReason" TEXT,
    "conversionHistory" JSONB,
    "stageHistory" JSONB,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_stages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "acceptanceCriteria" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_budget_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stageId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "plannedAmount" DOUBLE PRECISION NOT NULL,
    "actualAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "classification" TEXT NOT NULL DEFAULT 'capex',
    "vendorOrgId" TEXT,
    "purchaseOrderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "coNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scopeDelta" TEXT,
    "costDelta" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "scheduleDeltaDays" INTEGER,
    "classification" TEXT NOT NULL DEFAULT 'capex',
    "requestedByUserId" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersededByCoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acceptance_packs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requiredDocumentTypeKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submittedAt" TIMESTAMP(3),
    "contractorSignoffByUserId" TEXT,
    "contractorSignoffAt" TIMESTAMP(3),
    "managerSignoffByUserId" TEXT,
    "managerSignoffAt" TIMESTAMP(3),
    "chiefEngineerSignoffByUserId" TEXT,
    "chiefEngineerSignoffAt" TIMESTAMP(3),
    "ownerSignoffByUserId" TEXT,
    "ownerSignoffAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rejectionReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acceptance_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "taskInstanceId" TEXT,
    "vendorOrgId" TEXT,
    "contractId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'dispatched',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takeover_cases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "outgoingOrgId" TEXT,
    "incomingOrgId" TEXT,
    "targetGoLiveAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "signedOffAt" TIMESTAMP(3),
    "signoffLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takeover_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_spots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT,
    "code" TEXT NOT NULL,
    "spotType" TEXT NOT NULL DEFAULT 'reserved',
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isLeased" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parking_spots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT,
    "code" TEXT NOT NULL,
    "areaSqm" DOUBLE PRECISION,
    "isClimateControlled" BOOLEAN NOT NULL DEFAULT false,
    "isLeased" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_relations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "parentAssetId" TEXT NOT NULL,
    "childAssetId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'contains',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elevator_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "shaftCode" TEXT,
    "carType" TEXT,
    "capacityKg" INTEGER,
    "servedFromFloor" INTEGER,
    "servedToFloor" INTEGER,
    "speedMps" DOUBLE PRECISION,
    "controllerModel" TEXT,
    "vendorOrgId" TEXT,
    "rescueMode" TEXT,
    "lastInspectionAt" TIMESTAMP(3),
    "nextInspectionDue" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "elevator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT,
    "equipmentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "origin" TEXT NOT NULL,
    "reportedBy" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "rootCause" TEXT,
    "preventiveAction" TEXT,
    "workOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT,
    "qrLocationId" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'new',
    "description" TEXT,
    "photoKey" TEXT,
    "submittedBy" TEXT,
    "submitterContact" TEXT,
    "resolutionCode" TEXT,
    "workOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "vendorOrgId" TEXT,
    "requesterUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'requested',
    "revisionOf" TEXT,
    "receivedAt" TIMESTAMP(3),
    "approvalRequestId" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "quoteId" TEXT,
    "workOrderId" TEXT,
    "vendorOrgId" TEXT,
    "budgetLineId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "status" TEXT NOT NULL DEFAULT 'issued',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDeliveryAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT NOT NULL,
    "capexOpex" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "vendorOrgId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "taxAmount" DOUBLE PRECISION,
    "documentId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedPoAmount" DOUBLE PRECISION,
    "matchedCompletionAmount" DOUBLE PRECISION,
    "matchedByUserId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "varianceNotes" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_blackouts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "annualRecurring" BOOLEAN NOT NULL DEFAULT false,
    "policy" TEXT NOT NULL DEFAULT 'defer_to_next_working_day',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condition_triggers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "sensorPointId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "lastReadingValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "condition_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condition_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "sensorPointId" TEXT NOT NULL,
    "readingValue" DOUBLE PRECISION NOT NULL,
    "readingAt" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "taskInstanceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "condition_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'P1',
    "invokedByUserId" TEXT NOT NULL,
    "invokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ratificationDueBy" TIMESTAMP(3) NOT NULL,
    "ratifiedByUserId" TEXT,
    "ratifiedAt" TIMESTAMP(3),
    "ratificationNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_ratification',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completion_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "taskInstanceId" TEXT,
    "completedByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "labourHours" DOUBLE PRECISION,
    "labourCost" DOUBLE PRECISION,
    "materialsCost" DOUBLE PRECISION,
    "downtimeMinutes" INTEGER,
    "serviceReportDocumentId" TEXT,
    "photoDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completion_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'piece',
    "alternates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minLevel" INTEGER,
    "maxLevel" INTEGER,
    "reorderLevel" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'storeroom',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "movementType" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "workOrderId" TEXT,
    "taskInstanceId" TEXT,
    "purchaseOrderId" TEXT,
    "projectId" TEXT,
    "unitCost" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "reason" TEXT,
    "actorUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "spaceId" TEXT,
    "equipmentId" TEXT,
    "floorId" TEXT,
    "unitId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entrances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "entranceId" TEXT,
    "number" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT,
    "number" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "area" DOUBLE PRECISION,
    "rooms" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_settings" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "taxRules" JSONB,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" TEXT,
    "contactInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "monthlyCost" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "nextDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resident_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT,
    "createdBy" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resident_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_floors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorCode" TEXT NOT NULL,
    "floorNumber" INTEGER NOT NULL,
    "floorType" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "grossAreaSqm" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "areaSqm" DOUBLE PRECISION,
    "layoutZone" TEXT,
    "isDivisible" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'vacant',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationType" TEXT NOT NULL,
    "areaSqm" DOUBLE PRECISION,
    "isLeasable" BOOLEAN NOT NULL DEFAULT false,
    "unitId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_vertical_transport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "transportType" TEXT NOT NULL,
    "servesFromFloor" INTEGER NOT NULL,
    "servesToFloor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_vertical_transport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_systems" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "systemCategory" TEXT NOT NULL,
    "systemCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationType" TEXT,
    "floorId" TEXT,
    "quantity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_occupant_companies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyType" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_occupant_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_unit_occupancies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "occupantCompanyId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "occupancyStatus" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_unit_occupancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "occupantCompanyId" TEXT NOT NULL,
    "unitId" TEXT,
    "contractType" TEXT NOT NULL,
    "contractNumber" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "escalationPolicy" JSONB,
    "paymentFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "noticePeriodDays" INTEGER,
    "insuranceDocumentId" TEXT,

    CONSTRAINT "building_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "share" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "monthlyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_representatives" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "occupantCompanyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary_contact',
    "status" TEXT NOT NULL DEFAULT 'active',
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_representatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "specversion" TEXT NOT NULL DEFAULT '1.0',
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "subject" TEXT,
    "datacontenttype" TEXT NOT NULL DEFAULT 'application/json',
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sharedSecret" TEXT NOT NULL,
    "signatureHeader" TEXT NOT NULL DEFAULT 'x-signature',
    "signatureAlgo" TEXT NOT NULL DEFAULT 'sha256',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_webhook_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureOk" BOOLEAN NOT NULL,
    "rawHeaders" JSONB NOT NULL,
    "rawBody" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'logged',
    "notes" TEXT,

    CONSTRAINT "inbound_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_data_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "location" TEXT NOT NULL,
    "processors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_data_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dsar_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "subjectEmail" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "fulfilmentSummary" JSONB,
    "assignedToUserId" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "dsar_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subprocessor_registry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalEntity" TEXT,
    "countryCode" TEXT,
    "category" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "dpoEmail" TEXT,
    "region" TEXT,
    "dataCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subprocessor_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpa_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'EU',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bodyMarkdown" TEXT NOT NULL,
    "placeholders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retentionYears" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dpa_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_providers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'oidc',
    "issuerUrl" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY['openid', 'email', 'profile']::TEXT[],
    "authorizationEndpoint" TEXT,
    "tokenEndpoint" TEXT,
    "userinfoEndpoint" TEXT,
    "jwksUri" TEXT,
    "samlMetadataUrl" TEXT,
    "samlEntityId" TEXT,
    "emailClaim" TEXT NOT NULL DEFAULT 'email',
    "nameClaim" TEXT NOT NULL DEFAULT 'name',
    "groupClaim" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "rawClaims" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "federated_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_login_states" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "redirectTo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oidc_login_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signed_urls" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usesLeft" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "signed_urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_contractors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaning_contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_staff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "roleId" TEXT NOT NULL,
    "managerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaning_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_zones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floorId" TEXT,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zoneType" TEXT NOT NULL,
    "contractorId" TEXT,
    "supervisorStaffId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaning_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_qr_points" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "locationId" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaning_qr_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "qrPointId" TEXT,
    "createdByUserId" TEXT,
    "createdByGuestName" TEXT,
    "createdByGuestPhone" TEXT,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'new',
    "contractorId" TEXT,
    "assignedStaffId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaning_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_request_comments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorStaffId" TEXT,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_request_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_request_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_request_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'SHA1',
    "digits" INTEGER NOT NULL DEFAULT 6,
    "period" INTEGER NOT NULL DEFAULT 30,
    "enabledAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seed_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "seedName" TEXT NOT NULL,
    "seedVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL DEFAULT 'seed:test-building',
    "errorText" TEXT,

    CONSTRAINT "seed_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_profiles_tenantId_idx" ON "compliance_profiles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_profiles_tenantId_key_key" ON "compliance_profiles"("tenantId", "key");

-- CreateIndex
CREATE INDEX "building_compliance_profiles_tenantId_buildingId_idx" ON "building_compliance_profiles"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "building_compliance_profiles_buildingId_profileId_key" ON "building_compliance_profiles"("buildingId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_seedKey_key" ON "tenants"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailNormalized_key" ON "users"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_seedKey_key" ON "users"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "memberships_tenantId_userId_idx" ON "memberships"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenantId_userId_roleKey_key" ON "memberships"("tenantId", "userId", "roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_seedKey_key" ON "organizations"("seedKey");

-- CreateIndex
CREATE INDEX "organizations_tenantId_idx" ON "organizations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_tenantId_slug_key" ON "organizations"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "organization_memberships_organizationId_idx" ON "organization_memberships"("organizationId");

-- CreateIndex
CREATE INDEX "organization_memberships_userId_idx" ON "organization_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organizationId_userId_roleKey_key" ON "organization_memberships"("organizationId", "userId", "roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_seedKey_key" ON "buildings"("seedKey");

-- CreateIndex
CREATE INDEX "buildings_tenantId_idx" ON "buildings"("tenantId");

-- CreateIndex
CREATE INDEX "buildings_organizationId_idx" ON "buildings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_tenantId_slug_key" ON "buildings"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "assets_qrBarcode_key" ON "assets"("qrBarcode");

-- CreateIndex
CREATE UNIQUE INDEX "assets_seedKey_key" ON "assets"("seedKey");

-- CreateIndex
CREATE INDEX "assets_tenantId_buildingId_idx" ON "assets"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "assets_parentAssetId_idx" ON "assets"("parentAssetId");

-- CreateIndex
CREATE INDEX "assets_systemType_idx" ON "assets"("systemType");

-- CreateIndex
CREATE INDEX "assets_brickClass_idx" ON "assets"("brickClass");

-- CreateIndex
CREATE INDEX "assets_assetTypeId_idx" ON "assets"("assetTypeId");

-- CreateIndex
CREATE INDEX "assets_locationId_idx" ON "assets"("locationId");

-- CreateIndex
CREATE INDEX "assets_systemFamily_idx" ON "assets"("systemFamily");

-- CreateIndex
CREATE INDEX "assets_riskCriticality_idx" ON "assets"("riskCriticality");

-- CreateIndex
CREATE INDEX "assets_lifecycleStatus_idx" ON "assets"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "asset_types_tenantId_systemFamily_isActive_idx" ON "asset_types"("tenantId", "systemFamily", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "asset_types_tenantId_key_key" ON "asset_types"("tenantId", "key");

-- CreateIndex
CREATE INDEX "asset_custom_attributes_tenantId_attributeKey_idx" ON "asset_custom_attributes"("tenantId", "attributeKey");

-- CreateIndex
CREATE UNIQUE INDEX "asset_custom_attributes_assetId_attributeKey_key" ON "asset_custom_attributes"("assetId", "attributeKey");

-- CreateIndex
CREATE INDEX "asset_documents_tenantId_assetId_idx" ON "asset_documents"("tenantId", "assetId");

-- CreateIndex
CREATE INDEX "asset_documents_documentId_idx" ON "asset_documents"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_documents_assetId_documentId_docType_key" ON "asset_documents"("assetId", "documentId", "docType");

-- CreateIndex
CREATE INDEX "asset_media_tenantId_assetId_idx" ON "asset_media"("tenantId", "assetId");

-- CreateIndex
CREATE INDEX "spare_parts_tenantId_supplierId_idx" ON "spare_parts"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "spare_parts_tenantId_partNo_key" ON "spare_parts"("tenantId", "partNo");

-- CreateIndex
CREATE INDEX "asset_spare_parts_tenantId_assetId_idx" ON "asset_spare_parts"("tenantId", "assetId");

-- CreateIndex
CREATE INDEX "asset_spare_parts_partId_idx" ON "asset_spare_parts"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_spare_parts_assetId_partId_key" ON "asset_spare_parts"("assetId", "partId");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_points_seedKey_key" ON "sensor_points"("seedKey");

-- CreateIndex
CREATE INDEX "sensor_points_tenantId_buildingId_idx" ON "sensor_points"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "sensor_points_assetId_idx" ON "sensor_points"("assetId");

-- CreateIndex
CREATE INDEX "sensor_points_brickClass_idx" ON "sensor_points"("brickClass");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_points_buildingId_bacnetId_key" ON "sensor_points"("buildingId", "bacnetId");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_points_buildingId_opcNodeId_key" ON "sensor_points"("buildingId", "opcNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "alarm_sources_seedKey_key" ON "alarm_sources"("seedKey");

-- CreateIndex
CREATE INDEX "alarm_sources_tenantId_buildingId_idx" ON "alarm_sources"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "alarm_sources_assetId_idx" ON "alarm_sources"("assetId");

-- CreateIndex
CREATE INDEX "alarm_sources_severity_isActive_idx" ON "alarm_sources"("severity", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_templates_seedKey_key" ON "obligation_templates"("seedKey");

-- CreateIndex
CREATE INDEX "obligation_templates_tenantId_idx" ON "obligation_templates"("tenantId");

-- CreateIndex
CREATE INDEX "obligation_templates_domain_idx" ON "obligation_templates"("domain");

-- CreateIndex
CREATE INDEX "obligation_bases_obligationTemplateId_idx" ON "obligation_bases"("obligationTemplateId");

-- CreateIndex
CREATE INDEX "applicability_rules_obligationTemplateId_idx" ON "applicability_rules"("obligationTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "building_obligations_seedKey_key" ON "building_obligations"("seedKey");

-- CreateIndex
CREATE INDEX "building_obligations_tenantId_buildingId_idx" ON "building_obligations"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "ppm_templates_seedKey_key" ON "ppm_templates"("seedKey");

-- CreateIndex
CREATE INDEX "ppm_templates_tenantId_buildingId_idx" ON "ppm_templates"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "ppm_templates_buildingId_scope_idx" ON "ppm_templates"("buildingId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "ppm_plan_items_seedKey_key" ON "ppm_plan_items"("seedKey");

-- CreateIndex
CREATE INDEX "ppm_plan_items_tenantId_buildingId_nextDueAt_idx" ON "ppm_plan_items"("tenantId", "buildingId", "nextDueAt");

-- CreateIndex
CREATE INDEX "ppm_plan_items_buildingId_scope_idx" ON "ppm_plan_items"("buildingId", "scope");

-- CreateIndex
CREATE INDEX "ppm_plan_items_assetId_idx" ON "ppm_plan_items"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "task_instances_seedKey_key" ON "task_instances"("seedKey");

-- CreateIndex
CREATE INDEX "task_instances_tenantId_buildingId_dueAt_idx" ON "task_instances"("tenantId", "buildingId", "dueAt");

-- CreateIndex
CREATE INDEX "task_instances_status_idx" ON "task_instances"("status");

-- CreateIndex
CREATE INDEX "task_instances_lifecycleStage_idx" ON "task_instances"("lifecycleStage");

-- CreateIndex
CREATE INDEX "ppm_execution_logs_taskId_createdAt_idx" ON "ppm_execution_logs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ppm_execution_logs_tenantId_buildingId_idx" ON "ppm_execution_logs"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_seedKey_key" ON "budgets"("seedKey");

-- CreateIndex
CREATE INDEX "budgets_tenantId_buildingId_idx" ON "budgets"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_seedKey_key" ON "budget_lines"("seedKey");

-- CreateIndex
CREATE INDEX "budget_lines_budgetId_idx" ON "budget_lines"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_seedKey_key" ON "invoices"("seedKey");

-- CreateIndex
CREATE INDEX "invoices_tenantId_buildingId_idx" ON "invoices"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_seedKey_key" ON "approval_requests"("seedKey");

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_buildingId_status_idx" ON "approval_requests"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_seedKey_key" ON "approval_steps"("seedKey");

-- CreateIndex
CREATE INDEX "approval_steps_requestId_orderNo_idx" ON "approval_steps"("requestId", "orderNo");

-- CreateIndex
CREATE INDEX "approval_steps_status_idx" ON "approval_steps"("status");

-- CreateIndex
CREATE INDEX "approval_policies_tenantId_type_isActive_idx" ON "approval_policies"("tenantId", "type", "isActive");

-- CreateIndex
CREATE INDEX "approval_policies_tenantId_buildingId_type_idx" ON "approval_policies"("tenantId", "buildingId", "type");

-- CreateIndex
CREATE INDEX "approval_delegations_tenantId_delegateUserId_role_idx" ON "approval_delegations"("tenantId", "delegateUserId", "role");

-- CreateIndex
CREATE INDEX "approval_delegations_tenantId_delegatorUserId_role_idx" ON "approval_delegations"("tenantId", "delegatorUserId", "role");

-- CreateIndex
CREATE INDEX "approval_delegations_tenantId_endsAt_idx" ON "approval_delegations"("tenantId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "documents_seedKey_key" ON "documents"("seedKey");

-- CreateIndex
CREATE INDEX "documents_tenantId_buildingId_status_idx" ON "documents"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "documents_documentTypeKey_idx" ON "documents"("documentTypeKey");

-- CreateIndex
CREATE INDEX "documents_sha256_idx" ON "documents"("sha256");

-- CreateIndex
CREATE INDEX "documents_legalHold_idx" ON "documents"("legalHold");

-- CreateIndex
CREATE INDEX "documents_retentionUntil_idx" ON "documents"("retentionUntil");

-- CreateIndex
CREATE INDEX "documents_expiresAt_idx" ON "documents"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_entries_seedKey_key" ON "audit_entries"("seedKey");

-- CreateIndex
CREATE INDEX "audit_entries_tenantId_timestamp_idx" ON "audit_entries"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_entries_tenantId_buildingId_idx" ON "audit_entries"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "certifications_key_key" ON "certifications"("key");

-- CreateIndex
CREATE INDEX "user_certifications_expiresAt_idx" ON "user_certifications"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_certifications_userId_certificationId_key" ON "user_certifications"("userId", "certificationId");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_key_key" ON "document_types"("key");

-- CreateIndex
CREATE INDEX "document_templates_tenantId_buildingId_isActive_idx" ON "document_templates"("tenantId", "buildingId", "isActive");

-- CreateIndex
CREATE INDEX "document_templates_documentTypeKey_idx" ON "document_templates"("documentTypeKey");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_tenantId_key_key" ON "document_templates"("tenantId", "key");

-- CreateIndex
CREATE INDEX "rounds_tenantId_buildingId_isActive_idx" ON "rounds"("tenantId", "buildingId", "isActive");

-- CreateIndex
CREATE INDEX "round_waypoints_tenantId_roundId_idx" ON "round_waypoints"("tenantId", "roundId");

-- CreateIndex
CREATE INDEX "round_waypoints_documentTemplateId_idx" ON "round_waypoints"("documentTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "round_waypoints_roundId_orderNo_key" ON "round_waypoints"("roundId", "orderNo");

-- CreateIndex
CREATE INDEX "round_instances_tenantId_buildingId_status_idx" ON "round_instances"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "round_instances_roundId_idx" ON "round_instances"("roundId");

-- CreateIndex
CREATE INDEX "round_instance_answers_tenantId_instanceId_idx" ON "round_instance_answers"("tenantId", "instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "round_instance_answers_instanceId_waypointId_key" ON "round_instance_answers"("instanceId", "waypointId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "building_role_assignments_tenantId_buildingId_idx" ON "building_role_assignments"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "building_role_assignments_buildingId_userId_roleKey_key" ON "building_role_assignments"("buildingId", "userId", "roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "building_mandates_seedKey_key" ON "building_mandates"("seedKey");

-- CreateIndex
CREATE INDEX "building_mandates_tenantId_buildingId_idx" ON "building_mandates"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "import_jobs_tenantId_kind_idx" ON "import_jobs"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_job_rows_importJobId_status_idx" ON "import_job_rows"("importJobId", "status");

-- CreateIndex
CREATE INDEX "engineering_recommendations_tenantId_buildingId_status_idx" ON "engineering_recommendations"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "projects_tenantId_buildingId_idx" ON "projects"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "projects_classification_idx" ON "projects"("classification");

-- CreateIndex
CREATE INDEX "project_stages_tenantId_buildingId_projectId_idx" ON "project_stages"("tenantId", "buildingId", "projectId");

-- CreateIndex
CREATE INDEX "project_stages_status_idx" ON "project_stages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "project_stages_projectId_orderNo_key" ON "project_stages"("projectId", "orderNo");

-- CreateIndex
CREATE INDEX "project_budget_lines_tenantId_buildingId_projectId_idx" ON "project_budget_lines"("tenantId", "buildingId", "projectId");

-- CreateIndex
CREATE INDEX "project_budget_lines_stageId_idx" ON "project_budget_lines"("stageId");

-- CreateIndex
CREATE INDEX "project_budget_lines_classification_idx" ON "project_budget_lines"("classification");

-- CreateIndex
CREATE INDEX "change_orders_tenantId_buildingId_projectId_idx" ON "change_orders"("tenantId", "buildingId", "projectId");

-- CreateIndex
CREATE INDEX "change_orders_status_idx" ON "change_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_projectId_coNumber_key" ON "change_orders"("projectId", "coNumber");

-- CreateIndex
CREATE UNIQUE INDEX "acceptance_packs_projectId_key" ON "acceptance_packs"("projectId");

-- CreateIndex
CREATE INDEX "acceptance_packs_tenantId_buildingId_idx" ON "acceptance_packs"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "acceptance_packs_status_idx" ON "acceptance_packs"("status");

-- CreateIndex
CREATE INDEX "work_orders_tenantId_buildingId_status_idx" ON "work_orders"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "takeover_cases_tenantId_buildingId_idx" ON "takeover_cases"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "parking_spots_tenantId_buildingId_idx" ON "parking_spots"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "parking_spots_buildingId_code_key" ON "parking_spots"("buildingId", "code");

-- CreateIndex
CREATE INDEX "storage_units_tenantId_buildingId_idx" ON "storage_units"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "storage_units_buildingId_code_key" ON "storage_units"("buildingId", "code");

-- CreateIndex
CREATE INDEX "equipment_relations_tenantId_buildingId_idx" ON "equipment_relations"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_relations_parentAssetId_childAssetId_relationType_key" ON "equipment_relations"("parentAssetId", "childAssetId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "elevator_profiles_assetId_key" ON "elevator_profiles"("assetId");

-- CreateIndex
CREATE INDEX "elevator_profiles_tenantId_buildingId_idx" ON "elevator_profiles"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "document_links_targetType_targetId_idx" ON "document_links"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "document_links_tenantId_idx" ON "document_links"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_documentId_targetType_targetId_key" ON "document_links"("documentId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "incidents_tenantId_buildingId_status_idx" ON "incidents"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "incidents_severity_idx" ON "incidents"("severity");

-- CreateIndex
CREATE INDEX "service_requests_tenantId_buildingId_status_idx" ON "service_requests"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "service_requests_qrLocationId_idx" ON "service_requests"("qrLocationId");

-- CreateIndex
CREATE INDEX "quotes_tenantId_buildingId_status_idx" ON "quotes"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "quotes_workOrderId_idx" ON "quotes"("workOrderId");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_buildingId_status_idx" ON "purchase_orders"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_poNumber_key" ON "purchase_orders"("tenantId", "poNumber");

-- CreateIndex
CREATE INDEX "vendor_invoices_tenantId_buildingId_matchStatus_idx" ON "vendor_invoices"("tenantId", "buildingId", "matchStatus");

-- CreateIndex
CREATE INDEX "vendor_invoices_purchaseOrderId_idx" ON "vendor_invoices"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoices_tenantId_vendorOrgId_invoiceNumber_key" ON "vendor_invoices"("tenantId", "vendorOrgId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "calendar_blackouts_tenantId_buildingId_isActive_idx" ON "calendar_blackouts"("tenantId", "buildingId", "isActive");

-- CreateIndex
CREATE INDEX "calendar_blackouts_dayOfWeek_idx" ON "calendar_blackouts"("dayOfWeek");

-- CreateIndex
CREATE INDEX "condition_triggers_tenantId_buildingId_isActive_idx" ON "condition_triggers"("tenantId", "buildingId", "isActive");

-- CreateIndex
CREATE INDEX "condition_triggers_sensorPointId_idx" ON "condition_triggers"("sensorPointId");

-- CreateIndex
CREATE INDEX "condition_triggers_templateId_idx" ON "condition_triggers"("templateId");

-- CreateIndex
CREATE INDEX "condition_events_tenantId_triggerId_readingAt_idx" ON "condition_events"("tenantId", "triggerId", "readingAt");

-- CreateIndex
CREATE INDEX "condition_events_action_idx" ON "condition_events"("action");

-- CreateIndex
CREATE INDEX "emergency_overrides_tenantId_buildingId_status_idx" ON "emergency_overrides"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "emergency_overrides_targetType_targetId_idx" ON "emergency_overrides"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "emergency_overrides_ratificationDueBy_idx" ON "emergency_overrides"("ratificationDueBy");

-- CreateIndex
CREATE INDEX "completion_records_tenantId_buildingId_idx" ON "completion_records"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "completion_records_workOrderId_idx" ON "completion_records"("workOrderId");

-- CreateIndex
CREATE INDEX "completion_records_taskInstanceId_idx" ON "completion_records"("taskInstanceId");

-- CreateIndex
CREATE INDEX "inventory_items_tenantId_category_idx" ON "inventory_items"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenantId_sku_key" ON "inventory_items"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "stock_locations_tenantId_buildingId_idx" ON "stock_locations"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_tenantId_code_key" ON "stock_locations"("tenantId", "code");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_itemId_idx" ON "stock_movements"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_occurredAt_idx" ON "stock_movements"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_workOrderId_idx" ON "stock_movements"("workOrderId");

-- CreateIndex
CREATE INDEX "stock_movements_purchaseOrderId_idx" ON "stock_movements"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "qr_locations_tenantId_buildingId_idx" ON "qr_locations"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "qr_locations_buildingId_code_key" ON "qr_locations"("buildingId", "code");

-- CreateIndex
CREATE INDEX "entrances_tenantId_buildingId_idx" ON "entrances"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "entrances_buildingId_name_key" ON "entrances"("buildingId", "name");

-- CreateIndex
CREATE INDEX "floors_tenantId_buildingId_idx" ON "floors"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "floors_buildingId_entranceId_number_key" ON "floors"("buildingId", "entranceId", "number");

-- CreateIndex
CREATE INDEX "units_tenantId_buildingId_idx" ON "units"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "units_buildingId_number_key" ON "units"("buildingId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "building_settings_buildingId_key" ON "building_settings"("buildingId");

-- CreateIndex
CREATE INDEX "vendors_tenantId_idx" ON "vendors"("tenantId");

-- CreateIndex
CREATE INDEX "contracts_tenantId_buildingId_idx" ON "contracts"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "accounts_tenantId_buildingId_idx" ON "accounts"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "maintenance_plans_tenantId_buildingId_idx" ON "maintenance_plans"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "resident_requests_tenantId_buildingId_status_idx" ON "resident_requests"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_idx" ON "notifications"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "building_floors_tenantId_buildingId_floorNumber_idx" ON "building_floors"("tenantId", "buildingId", "floorNumber");

-- CreateIndex
CREATE UNIQUE INDEX "building_floors_buildingId_floorCode_key" ON "building_floors"("buildingId", "floorCode");

-- CreateIndex
CREATE INDEX "building_units_tenantId_buildingId_floorId_idx" ON "building_units"("tenantId", "buildingId", "floorId");

-- CreateIndex
CREATE UNIQUE INDEX "building_units_buildingId_unitCode_key" ON "building_units"("buildingId", "unitCode");

-- CreateIndex
CREATE UNIQUE INDEX "building_locations_unitId_key" ON "building_locations"("unitId");

-- CreateIndex
CREATE INDEX "building_locations_tenantId_buildingId_floorId_idx" ON "building_locations"("tenantId", "buildingId", "floorId");

-- CreateIndex
CREATE INDEX "building_locations_locationType_idx" ON "building_locations"("locationType");

-- CreateIndex
CREATE UNIQUE INDEX "building_locations_buildingId_code_key" ON "building_locations"("buildingId", "code");

-- CreateIndex
CREATE INDEX "building_vertical_transport_tenantId_buildingId_transportTy_idx" ON "building_vertical_transport"("tenantId", "buildingId", "transportType");

-- CreateIndex
CREATE UNIQUE INDEX "building_vertical_transport_buildingId_code_key" ON "building_vertical_transport"("buildingId", "code");

-- CreateIndex
CREATE INDEX "building_systems_tenantId_buildingId_systemCategory_idx" ON "building_systems"("tenantId", "buildingId", "systemCategory");

-- CreateIndex
CREATE UNIQUE INDEX "building_systems_buildingId_systemCode_key" ON "building_systems"("buildingId", "systemCode");

-- CreateIndex
CREATE INDEX "building_occupant_companies_tenantId_buildingId_idx" ON "building_occupant_companies"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "building_unit_occupancies_tenantId_buildingId_unitId_idx" ON "building_unit_occupancies"("tenantId", "buildingId", "unitId");

-- CreateIndex
CREATE INDEX "building_unit_occupancies_occupantCompanyId_idx" ON "building_unit_occupancies"("occupantCompanyId");

-- CreateIndex
CREATE INDEX "building_contracts_tenantId_buildingId_contractType_idx" ON "building_contracts"("tenantId", "buildingId", "contractType");

-- CreateIndex
CREATE INDEX "building_contracts_occupantCompanyId_idx" ON "building_contracts"("occupantCompanyId");

-- CreateIndex
CREATE INDEX "lease_allocations_tenantId_contractId_idx" ON "lease_allocations"("tenantId", "contractId");

-- CreateIndex
CREATE INDEX "lease_allocations_tenantId_targetType_targetId_idx" ON "lease_allocations"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "lease_allocations_contractId_targetType_targetId_key" ON "lease_allocations"("contractId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "tenant_representatives_tenantId_userId_idx" ON "tenant_representatives"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "tenant_representatives_tenantId_buildingId_idx" ON "tenant_representatives"("tenantId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_representatives_occupantCompanyId_userId_key" ON "tenant_representatives"("occupantCompanyId", "userId");

-- CreateIndex
CREATE INDEX "outbox_events_tenantId_status_createdAt_idx" ON "outbox_events"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_type_idx" ON "outbox_events"("type");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_tenantId_isActive_idx" ON "webhook_subscriptions"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhook_sources_tenantId_channel_key" ON "inbound_webhook_sources"("tenantId", "channel");

-- CreateIndex
CREATE INDEX "inbound_webhook_events_tenantId_channel_receivedAt_idx" ON "inbound_webhook_events"("tenantId", "channel", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "personal_data_categories_tenantId_key_key" ON "personal_data_categories"("tenantId", "key");

-- CreateIndex
CREATE INDEX "dsar_requests_tenantId_status_idx" ON "dsar_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "dsar_requests_subjectEmail_idx" ON "dsar_requests"("subjectEmail");

-- CreateIndex
CREATE INDEX "subprocessor_registry_tenantId_status_idx" ON "subprocessor_registry"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subprocessor_registry_tenantId_name_key" ON "subprocessor_registry"("tenantId", "name");

-- CreateIndex
CREATE INDEX "dpa_templates_tenantId_isActive_idx" ON "dpa_templates"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "dpa_templates_tenantId_key_jurisdiction_version_key" ON "dpa_templates"("tenantId", "key", "jurisdiction", "version");

-- CreateIndex
CREATE INDEX "identity_providers_tenantId_isActive_idx" ON "identity_providers"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_tenantId_key_key" ON "identity_providers"("tenantId", "key");

-- CreateIndex
CREATE INDEX "federated_identities_userId_idx" ON "federated_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "federated_identities_providerId_subject_key" ON "federated_identities"("providerId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_login_states_state_key" ON "oidc_login_states"("state");

-- CreateIndex
CREATE INDEX "oidc_login_states_expiresAt_idx" ON "oidc_login_states"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "scim_tokens_tokenHash_key" ON "scim_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "scim_tokens_tenantId_isActive_idx" ON "scim_tokens"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "signed_urls_token_key" ON "signed_urls"("token");

-- CreateIndex
CREATE INDEX "signed_urls_tenantId_documentId_idx" ON "signed_urls"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "signed_urls_expiresAt_idx" ON "signed_urls"("expiresAt");

-- CreateIndex
CREATE INDEX "cleaning_contractors_tenantId_buildingId_isActive_idx" ON "cleaning_contractors"("tenantId", "buildingId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_contractors_buildingId_name_key" ON "cleaning_contractors"("buildingId", "name");

-- CreateIndex
CREATE INDEX "cleaning_roles_tenantId_contractorId_idx" ON "cleaning_roles"("tenantId", "contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_roles_contractorId_code_key" ON "cleaning_roles"("contractorId", "code");

-- CreateIndex
CREATE INDEX "cleaning_staff_tenantId_contractorId_isActive_idx" ON "cleaning_staff"("tenantId", "contractorId", "isActive");

-- CreateIndex
CREATE INDEX "cleaning_staff_userId_idx" ON "cleaning_staff"("userId");

-- CreateIndex
CREATE INDEX "cleaning_staff_managerId_idx" ON "cleaning_staff"("managerId");

-- CreateIndex
CREATE INDEX "cleaning_zones_tenantId_buildingId_contractorId_idx" ON "cleaning_zones"("tenantId", "buildingId", "contractorId");

-- CreateIndex
CREATE INDEX "cleaning_zones_zoneType_idx" ON "cleaning_zones"("zoneType");

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_zones_buildingId_code_key" ON "cleaning_zones"("buildingId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_qr_points_code_key" ON "cleaning_qr_points"("code");

-- CreateIndex
CREATE INDEX "cleaning_qr_points_tenantId_buildingId_isActive_idx" ON "cleaning_qr_points"("tenantId", "buildingId", "isActive");

-- CreateIndex
CREATE INDEX "cleaning_qr_points_zoneId_idx" ON "cleaning_qr_points"("zoneId");

-- CreateIndex
CREATE INDEX "cleaning_requests_tenantId_buildingId_status_idx" ON "cleaning_requests"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "cleaning_requests_contractorId_status_idx" ON "cleaning_requests"("contractorId", "status");

-- CreateIndex
CREATE INDEX "cleaning_requests_assignedStaffId_status_idx" ON "cleaning_requests"("assignedStaffId", "status");

-- CreateIndex
CREATE INDEX "cleaning_requests_zoneId_idx" ON "cleaning_requests"("zoneId");

-- CreateIndex
CREATE INDEX "cleaning_requests_dueAt_idx" ON "cleaning_requests"("dueAt");

-- CreateIndex
CREATE INDEX "cleaning_request_comments_requestId_createdAt_idx" ON "cleaning_request_comments"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "cleaning_request_comments_tenantId_idx" ON "cleaning_request_comments"("tenantId");

-- CreateIndex
CREATE INDEX "cleaning_request_attachments_requestId_idx" ON "cleaning_request_attachments"("requestId");

-- CreateIndex
CREATE INDEX "cleaning_request_attachments_tenantId_idx" ON "cleaning_request_attachments"("tenantId");

-- CreateIndex
CREATE INDEX "cleaning_request_history_requestId_createdAt_idx" ON "cleaning_request_history"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "cleaning_request_history_tenantId_idx" ON "cleaning_request_history"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_userId_key" ON "user_mfa"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "seed_runs_seedName_seedVersion_key" ON "seed_runs"("seedName", "seedVersion");

-- AddForeignKey
ALTER TABLE "building_compliance_profiles" ADD CONSTRAINT "building_compliance_profiles_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "compliance_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_templates" ADD CONSTRAINT "obligation_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_bases" ADD CONSTRAINT "obligation_bases_obligationTemplateId_fkey" FOREIGN KEY ("obligationTemplateId") REFERENCES "obligation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicability_rules" ADD CONSTRAINT "applicability_rules_obligationTemplateId_fkey" FOREIGN KEY ("obligationTemplateId") REFERENCES "obligation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_obligations" ADD CONSTRAINT "building_obligations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_obligations" ADD CONSTRAINT "building_obligations_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_obligations" ADD CONSTRAINT "building_obligations_obligationTemplateId_fkey" FOREIGN KEY ("obligationTemplateId") REFERENCES "obligation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_templates" ADD CONSTRAINT "ppm_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_templates" ADD CONSTRAINT "ppm_templates_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_plan_items" ADD CONSTRAINT "ppm_plan_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_plan_items" ADD CONSTRAINT "ppm_plan_items_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_plan_items" ADD CONSTRAINT "ppm_plan_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ppm_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_plan_items" ADD CONSTRAINT "ppm_plan_items_obligationTemplateId_fkey" FOREIGN KEY ("obligationTemplateId") REFERENCES "obligation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_plan_items" ADD CONSTRAINT "ppm_plan_items_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "ppm_plan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppm_execution_logs" ADD CONSTRAINT "ppm_execution_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_certifications" ADD CONSTRAINT "user_certifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_certifications" ADD CONSTRAINT "user_certifications_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "certifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_waypoints" ADD CONSTRAINT "round_waypoints_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "roles"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_role_assignments" ADD CONSTRAINT "building_role_assignments_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_role_assignments" ADD CONSTRAINT "building_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_role_assignments" ADD CONSTRAINT "building_role_assignments_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "roles"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_mandates" ADD CONSTRAINT "building_mandates_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_mandates" ADD CONSTRAINT "building_mandates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_recommendations" ADD CONSTRAINT "engineering_recommendations_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "task_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeover_cases" ADD CONSTRAINT "takeover_cases_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrances" ADD CONSTRAINT "entrances_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_entranceId_fkey" FOREIGN KEY ("entranceId") REFERENCES "entrances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "floors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_settings" ADD CONSTRAINT "building_settings_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_requests" ADD CONSTRAINT "resident_requests_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_floors" ADD CONSTRAINT "building_floors_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_units" ADD CONSTRAINT "building_units_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_units" ADD CONSTRAINT "building_units_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "building_floors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_vertical_transport" ADD CONSTRAINT "building_vertical_transport_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_systems" ADD CONSTRAINT "building_systems_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_systems" ADD CONSTRAINT "building_systems_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "building_floors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_occupant_companies" ADD CONSTRAINT "building_occupant_companies_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_unit_occupancies" ADD CONSTRAINT "building_unit_occupancies_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_unit_occupancies" ADD CONSTRAINT "building_unit_occupancies_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "building_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_unit_occupancies" ADD CONSTRAINT "building_unit_occupancies_occupantCompanyId_fkey" FOREIGN KEY ("occupantCompanyId") REFERENCES "building_occupant_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_contracts" ADD CONSTRAINT "building_contracts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_contracts" ADD CONSTRAINT "building_contracts_occupantCompanyId_fkey" FOREIGN KEY ("occupantCompanyId") REFERENCES "building_occupant_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_contracts" ADD CONSTRAINT "building_contracts_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "building_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_allocations" ADD CONSTRAINT "lease_allocations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "building_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seed_runs" ADD CONSTRAINT "seed_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

