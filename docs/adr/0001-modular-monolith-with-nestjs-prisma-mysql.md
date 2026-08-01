# 采用 NestJS、Prisma 和 MySQL 的模块化单体

服务器先作为一个模块化单体部署，业务按拥有数据的 Module 隔离，通过 NestJS 提供传输 Interface，并使用 Prisma 和 MySQL 维护事务事实。相比立即拆微服务，这一选择保留清晰 Seam，同时避免在比赛和首个产品阶段承担分布式一致性、部署和联调成本；只有经过实际容量或团队边界验证的 Module 才考虑独立部署。

