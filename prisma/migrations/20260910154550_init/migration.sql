-- CreateTable
CREATE TABLE `requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `method` VARCHAR(16) NOT NULL,
    `url` TEXT NOT NULL,
    `headers` JSON NOT NULL,
    `query` JSON NOT NULL,
    `body` LONGTEXT NULL,
    `body_encoding` VARCHAR(8) NOT NULL DEFAULT 'utf8',
    `body_size` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
